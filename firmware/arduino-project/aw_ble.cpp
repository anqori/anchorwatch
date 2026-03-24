#include "aw_ble.h"

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <esp_bt.h>

#include <vector>

#include "aw_constants.h"

namespace aw {

namespace {

uint32_t fnv1a32(const String& value) {
  uint32_t hash = 2166136261u;
  for (size_t index = 0; index < value.length(); index++) {
    hash ^= static_cast<uint8_t>(value.charAt(index));
    hash *= 16777619u;
  }
  return hash;
}

struct ChunkAssembly {
  uint32_t msg_id = 0;
  uint8_t part_count = 0;
  unsigned long updated_at = 0;
  std::vector<String> parts;
  std::vector<bool> received;
};

class ServerCallbacks : public BLEServerCallbacks {
 public:
  explicit ServerCallbacks(BleTransport::Impl* impl) : impl_(impl) {}
  void onConnect(BLEServer* server) override;
  void onDisconnect(BLEServer* server) override;

 private:
  BleTransport::Impl* impl_;
};

class ControlCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit ControlCallbacks(BleTransport::Impl* impl) : impl_(impl) {}
  void onWrite(BLECharacteristic* characteristic) override;

 private:
  BleTransport::Impl* impl_;
};

class SnapshotCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit SnapshotCallbacks(BleTransport::Impl* impl) : impl_(impl) {}
  void onRead(BLECharacteristic* characteristic) override;

 private:
  BleTransport::Impl* impl_;
};

class AuthCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit AuthCallbacks(BleTransport::Impl* impl) : impl_(impl) {}
  void onRead(BLECharacteristic* characteristic) override;
  void onWrite(BLECharacteristic* characteristic) override;

 private:
  BleTransport::Impl* impl_;
};

}  // namespace

struct BleTransport::Impl {
  BLEServer* server = nullptr;
  BLEService* service = nullptr;
  BLECharacteristic* control_tx = nullptr;
  BLECharacteristic* event_rx = nullptr;
  BLECharacteristic* snapshot = nullptr;
  BLECharacteristic* auth = nullptr;
  BleTransportListener* listener = nullptr;
  bool connected = false;
  bool ready = false;
  String auth_value = "{}";
  String snapshot_value = "{}";
  std::vector<ChunkAssembly> assemblies;

  void handleControlWrite(const uint8_t* bytes, size_t length) {
    if (length < 6) {
      return;
    }
    const uint32_t msg_id = static_cast<uint32_t>(bytes[0]) |
      (static_cast<uint32_t>(bytes[1]) << 8) |
      (static_cast<uint32_t>(bytes[2]) << 16) |
      (static_cast<uint32_t>(bytes[3]) << 24);
    const uint8_t part_index = bytes[4];
    const uint8_t part_count = bytes[5];
    if (part_count == 0 || part_index >= part_count) {
      return;
    }
    ChunkAssembly* target = nullptr;
    for (ChunkAssembly& assembly : assemblies) {
      if (assembly.msg_id == msg_id && assembly.part_count == part_count) {
        target = &assembly;
        break;
      }
    }
    if (target == nullptr) {
      assemblies.push_back({});
      target = &assemblies.back();
      target->msg_id = msg_id;
      target->part_count = part_count;
      target->parts.assign(part_count, "");
      target->received.assign(part_count, false);
    }
    target->updated_at = millis();
    target->parts[part_index] = String(reinterpret_cast<const char*>(bytes + 6), length - 6);
    target->received[part_index] = true;
    for (bool received : target->received) {
      if (!received) {
        return;
      }
    }
    String combined;
    for (const String& part : target->parts) {
      combined += part;
    }
    for (size_t index = 0; index < assemblies.size(); index++) {
      if (&assemblies[index] == target) {
        assemblies.erase(assemblies.begin() + index);
        break;
      }
    }
    if (listener != nullptr) {
      listener->onBleJsonMessage(combined);
    }
  }

  void handleAuthWrite(const String& action) {
    if (listener != nullptr) {
      listener->onBleAuthAction(action);
    }
  }
};

void ServerCallbacks::onConnect(BLEServer* server) {
  (void)server;
  if (impl_ != nullptr) {
    Serial.println("[ble] client connected");
    impl_->connected = true;
    if (impl_->listener != nullptr) {
      impl_->listener->onBleConnectionChanged(true);
    }
  }
}

void ServerCallbacks::onDisconnect(BLEServer* server) {
  (void)server;
  if (impl_ != nullptr) {
    Serial.println("[ble] client disconnected");
    impl_->connected = false;
    if (impl_->listener != nullptr) {
      impl_->listener->onBleConnectionChanged(false);
    }
    BLEDevice::startAdvertising();
  }
}

void ControlCallbacks::onWrite(BLECharacteristic* characteristic) {
  if (impl_ == nullptr || characteristic == nullptr) {
    return;
  }
  String raw = characteristic->getValue();
  Serial.printf("[ble] control write len=%u\n", static_cast<unsigned>(raw.length()));
  impl_->handleControlWrite(reinterpret_cast<const uint8_t*>(raw.c_str()), raw.length());
}

void SnapshotCallbacks::onRead(BLECharacteristic* characteristic) {
  if (impl_ == nullptr || characteristic == nullptr) {
    return;
  }
  Serial.printf("[ble] snapshot read len=%u\n", static_cast<unsigned>(impl_->snapshot_value.length()));
  characteristic->setValue(impl_->snapshot_value.c_str());
}

void AuthCallbacks::onRead(BLECharacteristic* characteristic) {
  if (impl_ == nullptr || characteristic == nullptr) {
    return;
  }
  Serial.printf("[ble] auth read len=%u value=%s\n", static_cast<unsigned>(impl_->auth_value.length()), impl_->auth_value.c_str());
  characteristic->setValue(impl_->auth_value.c_str());
}

void AuthCallbacks::onWrite(BLECharacteristic* characteristic) {
  if (impl_ == nullptr || characteristic == nullptr) {
    return;
  }
  String action = characteristic->getValue();
  action.trim();
  if (!action.isEmpty()) {
    Serial.printf("[ble] auth write action=%s\n", action.c_str());
    impl_->handleAuthWrite(action);
  }
}

BleTransport::BleTransport() : impl_(new Impl()) {}

bool BleTransport::begin(const String& device_name, BleTransportListener* listener) {
  impl_->listener = listener;
  impl_->ready = false;

  esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);

  if (!BLEDevice::init(device_name.c_str()) || !BLEDevice::getInitialized()) {
    log_e("BLE init failed for device '%s'", device_name.c_str());
    return false;
  }

  BLEDevice::setMTU(185);
  impl_->server = BLEDevice::createServer();
  if (impl_->server == nullptr) {
    log_e("BLE createServer failed");
    return false;
  }
  impl_->server->setCallbacks(new ServerCallbacks(impl_));
  impl_->service = impl_->server->createService(BLE_SERVICE_UUID);
  if (impl_->service == nullptr) {
    log_e("BLE createService failed");
    return false;
  }

  impl_->control_tx = impl_->service->createCharacteristic(
    BLE_CONTROL_TX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  impl_->control_tx->setCallbacks(new ControlCallbacks(impl_));

  impl_->event_rx = impl_->service->createCharacteristic(BLE_EVENT_RX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  impl_->event_rx->addDescriptor(new BLE2902());

  impl_->snapshot = impl_->service->createCharacteristic(BLE_SNAPSHOT_UUID, BLECharacteristic::PROPERTY_READ);
  impl_->snapshot->setCallbacks(new SnapshotCallbacks(impl_));
  impl_->snapshot->setValue(impl_->snapshot_value.c_str());

  impl_->auth = impl_->service->createCharacteristic(
    BLE_AUTH_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  impl_->auth->setCallbacks(new AuthCallbacks(impl_));
  impl_->auth->setValue(impl_->auth_value.c_str());

  impl_->service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  if (advertising == nullptr) {
    log_e("BLE getAdvertising failed");
    return false;
  }
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  impl_->ready = true;
  return true;
}

void BleTransport::loop(unsigned long now_ms) {
  for (size_t index = 0; index < impl_->assemblies.size();) {
    if (now_ms - impl_->assemblies[index].updated_at > BLE_CHUNK_TIMEOUT_MS) {
      impl_->assemblies.erase(impl_->assemblies.begin() + index);
      continue;
    }
    index++;
  }
}

bool BleTransport::sendJson(const String& json) {
  if (!impl_->ready || !impl_->connected || impl_->event_rx == nullptr) {
    return false;
  }
  const uint32_t msg_id = fnv1a32(String(millis()) + ":" + String(esp_random()));
  const size_t part_count = std::max<size_t>(1U, (json.length() + BLE_CHUNK_MAX_PAYLOAD - 1U) / BLE_CHUNK_MAX_PAYLOAD);
  for (size_t part_index = 0; part_index < part_count; part_index++) {
    const size_t offset = part_index * BLE_CHUNK_MAX_PAYLOAD;
    const String chunk = json.substring(offset, offset + BLE_CHUNK_MAX_PAYLOAD);
    std::vector<uint8_t> frame(6U + chunk.length());
    frame[0] = msg_id & 0xff;
    frame[1] = (msg_id >> 8) & 0xff;
    frame[2] = (msg_id >> 16) & 0xff;
    frame[3] = (msg_id >> 24) & 0xff;
    frame[4] = static_cast<uint8_t>(part_index);
    frame[5] = static_cast<uint8_t>(part_count);
    memcpy(frame.data() + 6, chunk.c_str(), chunk.length());
    impl_->event_rx->setValue(frame.data(), frame.size());
    impl_->event_rx->notify();
    delay(BLE_NOTIFY_INTER_CHUNK_DELAY_MS);
  }
  return true;
}

void BleTransport::setAuthValue(const String& value) {
  impl_->auth_value = value;
  if (impl_->auth != nullptr) {
    impl_->auth->setValue(value.c_str());
  }
}

void BleTransport::setSnapshotValue(const String& value) {
  impl_->snapshot_value = value;
  if (impl_->snapshot != nullptr) {
    impl_->snapshot->setValue(value.c_str());
  }
}

bool BleTransport::isConnected() const {
  return impl_->connected;
}

bool BleTransport::isReady() const {
  return impl_->ready;
}

}  // namespace aw
