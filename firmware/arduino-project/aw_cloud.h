#pragma once

#include <Arduino.h>

#include "aw_model.h"

namespace aw {

class CloudTransportListener {
 public:
  virtual ~CloudTransportListener() = default;
  virtual void onCloudSessionOpened(const String& cloud_conn_id) = 0;
  virtual void onCloudSessionPayload(const String& cloud_conn_id, const String& payload_json) = 0;
  virtual void onCloudSessionClosed(const String& cloud_conn_id, const String& reason) = 0;
};

class CloudTransport {
 public:
  struct Impl;

  CloudTransport();

  void begin(CloudTransportListener* listener);
  void loop(unsigned long now_ms, bool wlan_connected, const CloudConfigValue& config);
  bool sendPayload(const String& cloud_conn_id, const String& payload_json);
  bool isConnected() const;
  String lastError() const;

 private:
  Impl* impl_;
};

}  // namespace aw
