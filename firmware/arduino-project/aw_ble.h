#pragma once

#include <Arduino.h>

namespace aw {

class BleTransportListener {
 public:
  virtual ~BleTransportListener() = default;
  virtual void onBleJsonMessage(const String& json) = 0;
  virtual void onBleAuthAction(const String& action) = 0;
  virtual void onBleConnectionChanged(bool connected) = 0;
};

class BleTransport {
 public:
  struct Impl;

  BleTransport();

  bool begin(const String& device_name, BleTransportListener* listener);
  void loop(unsigned long now_ms);
  bool sendJson(const String& json);
  void setAuthValue(const String& value);
  void setSnapshotValue(const String& value);
  bool isConnected() const;
  bool isReady() const;

 private:
  Impl* impl_;
};

}  // namespace aw
