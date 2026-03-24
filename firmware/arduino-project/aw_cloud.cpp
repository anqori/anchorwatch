#include "aw_cloud.h"

#include <NetworkClientSecure.h>
#include <SHA1Builder.h>
#include <base64.h>

#include <stdlib.h>
#include <vector>

#include "aw_constants.h"
#include "aw_json.h"

namespace aw {

namespace {

static const char* TRANSPORT_KIND_OPEN = "OPEN";
static const char* TRANSPORT_KIND_PAYLOAD = "PAYLOAD";
static const char* TRANSPORT_KIND_CLOSE = "CLOSE";
static const char* WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

void appendFieldRaw(String& out, bool& first, const char* key, const String& raw_value) {
  if (!first) {
    out += ",";
  }
  out += jsonQuote(key);
  out += ":";
  out += raw_value;
  first = false;
}

bool containsString(const std::vector<String>& values, const String& target) {
  for (const String& value : values) {
    if (value == target) {
      return true;
    }
  }
  return false;
}

void eraseString(std::vector<String>& values, const String& target) {
  for (size_t index = 0; index < values.size(); index++) {
    if (values[index] == target) {
      values.erase(values.begin() + index);
      return;
    }
  }
}

String urlEncode(const String& raw) {
  String out;
  out.reserve(raw.length() * 3);
  for (size_t index = 0; index < raw.length(); index++) {
    const uint8_t value = static_cast<uint8_t>(raw.charAt(index));
    const bool safe =
      (value >= 'A' && value <= 'Z') ||
      (value >= 'a' && value <= 'z') ||
      (value >= '0' && value <= '9') ||
      value == '-' || value == '_' || value == '.' || value == '~';
    if (safe) {
      out += static_cast<char>(value);
      continue;
    }
    const char* hex = "0123456789ABCDEF";
    out += '%';
    out += hex[(value >> 4) & 0x0f];
    out += hex[value & 0x0f];
  }
  return out;
}

String makeTicketRequestBody(const CloudConfigValue& config) {
  String out = "{";
  bool first = true;
  appendFieldRaw(out, first, "boat_id", jsonQuote(config.boat_id));
  appendFieldRaw(out, first, "cloud_secret", jsonQuote(config.cloud_secret));
  appendFieldRaw(out, first, "role", jsonQuote("server"));
  out += "}";
  return out;
}

String makeExpectedAccept(const String& sec_websocket_key) {
  SHA1Builder sha1;
  sha1.begin();
  const String combined = sec_websocket_key + WS_GUID;
  sha1.add(reinterpret_cast<const uint8_t*>(combined.c_str()), combined.length());
  sha1.calculate();
  uint8_t digest[20];
  sha1.getBytes(digest);
  return base64::encode(digest, sizeof(digest));
}

bool writeAll(NetworkClientSecure& client, const uint8_t* data, size_t length) {
  size_t written = 0;
  while (written < length) {
    const size_t chunk = client.write(data + written, length - written);
    if (chunk == 0) {
      return false;
    }
    written += chunk;
  }
  return true;
}

bool writeAll(NetworkClientSecure& client, const String& data) {
  return writeAll(client, reinterpret_cast<const uint8_t*>(data.c_str()), data.length());
}

String buildPayloadEnvelope(const String& cloud_conn_id, const String& payload_json) {
  String out = "{";
  bool first = true;
  appendFieldRaw(out, first, "kind", jsonQuote(TRANSPORT_KIND_PAYLOAD));
  appendFieldRaw(out, first, "cloud_conn_id", jsonQuote(cloud_conn_id));
  appendFieldRaw(out, first, "payload", payload_json);
  out += "}";
  return out;
}

String findHeaderValue(const String& response_headers, const char* header_name) {
  const String prefix = String(header_name) + ":";
  const int header_index = response_headers.indexOf(prefix);
  if (header_index < 0) {
    return "";
  }
  const int value_start = header_index + prefix.length();
  const int value_end = response_headers.indexOf("\r\n", value_start);
  String value = response_headers.substring(value_start, value_end >= 0 ? value_end : response_headers.length());
  value.trim();
  return value;
}

bool parseDecimalSize(const String& raw, size_t& value) {
  char* end_ptr = nullptr;
  const unsigned long parsed = strtoul(raw.c_str(), &end_ptr, 10);
  if (end_ptr == raw.c_str() || *end_ptr != '\0') {
    return false;
  }
  value = static_cast<size_t>(parsed);
  return true;
}

bool decodeChunkedBody(const String& encoded, String& decoded) {
  decoded = "";
  size_t index = 0;
  while (index < encoded.length()) {
    const int line_end = encoded.indexOf("\r\n", index);
    if (line_end < 0) {
      return false;
    }
    String length_hex = encoded.substring(index, line_end);
    const int extension_start = length_hex.indexOf(';');
    if (extension_start >= 0) {
      length_hex = length_hex.substring(0, extension_start);
    }
    length_hex.trim();
    char* end_ptr = nullptr;
    const unsigned long chunk_length = strtoul(length_hex.c_str(), &end_ptr, 16);
    if (end_ptr == length_hex.c_str() || *end_ptr != '\0') {
      return false;
    }
    index = static_cast<size_t>(line_end) + 2U;
    if (encoded.length() < index + chunk_length + 2U) {
      return false;
    }
    if (chunk_length == 0U) {
      return true;
    }
    decoded += encoded.substring(index, index + chunk_length);
    index += chunk_length;
    if (encoded.substring(index, index + 2U) != "\r\n") {
      return false;
    }
    index += 2U;
  }
  return false;
}

bool readHttpResponse(NetworkClientSecure& client, String& response_headers, String& response_body) {
  response_headers = "";
  response_body = "";
  bool headers_done = false;
  bool chunked = false;
  bool has_content_length = false;
  size_t content_length = 0;
  const unsigned long started_at = millis();
  while (millis() - started_at < CLOUD_HTTP_TIMEOUT_MS) {
    while (client.available() > 0) {
      const char c = static_cast<char>(client.read());
      if (!headers_done) {
        response_headers += c;
        if (response_headers.endsWith("\r\n\r\n")) {
          headers_done = true;
          String transfer_encoding = findHeaderValue(response_headers, "Transfer-Encoding");
          transfer_encoding.toLowerCase();
          chunked = transfer_encoding.indexOf("chunked") >= 0;
          const String content_length_raw = findHeaderValue(response_headers, "Content-Length");
          has_content_length = parseDecimalSize(content_length_raw, content_length);
          if (headers_done && has_content_length && content_length == 0U && !chunked) {
            return true;
          }
        }
      } else {
        response_body += c;
        if (has_content_length && response_body.length() >= content_length) {
          return true;
        }
      }
    }

    if (!client.connected()) {
      if (!headers_done) {
        return false;
      }
      if (!chunked) {
        return true;
      }
      String decoded_body;
      if (!decodeChunkedBody(response_body, decoded_body)) {
        return false;
      }
      response_body = decoded_body;
      return true;
    }
    delay(1);
  }
  return false;
}

}  // namespace

struct CloudTransport::Impl {
  CloudTransportListener* listener = nullptr;
  NetworkClientSecure socket;
  bool connected = false;
  String last_error;
  String active_boat_id;
  String active_cloud_secret;
  unsigned long next_connect_ms = 0;
  unsigned long retry_delay_ms = CLOUD_RETRY_MIN_MS;
  unsigned long last_ping_ms = 0;
  std::vector<uint8_t> rx_buffer;
  std::vector<String> cloud_sessions;

  void begin(CloudTransportListener* next_listener) {
    listener = next_listener;
  }

  bool credentialsMatch(const CloudConfigValue& config) const {
    return active_boat_id == config.boat_id && active_cloud_secret == config.cloud_secret;
  }

  void scheduleReconnect(unsigned long now_ms) {
    next_connect_ms = now_ms + retry_delay_ms;
    retry_delay_ms = min<unsigned long>(retry_delay_ms * 2UL, CLOUD_RETRY_MAX_MS);
  }

  void resetRetryBackoff(unsigned long now_ms) {
    next_connect_ms = now_ms + CLOUD_RETRY_MIN_MS;
    retry_delay_ms = CLOUD_RETRY_MIN_MS;
  }

  void notifySessionClosed(const String& cloud_conn_id, const String& reason) {
    if (listener != nullptr) {
      listener->onCloudSessionClosed(cloud_conn_id, reason);
    }
  }

  void notifyAllSessionsClosed(const String& reason) {
    const std::vector<String> closed_sessions = cloud_sessions;
    cloud_sessions.clear();
    for (const String& cloud_conn_id : closed_sessions) {
      notifySessionClosed(cloud_conn_id, reason);
    }
  }

  void disconnect(const String& reason, unsigned long now_ms, bool should_retry) {
    if (connected || !cloud_sessions.empty()) {
      notifyAllSessionsClosed(reason);
    } else {
      cloud_sessions.clear();
    }
    if (socket.connected()) {
      socket.stop();
    }
    connected = false;
    rx_buffer.clear();
    active_boat_id = "";
    active_cloud_secret = "";
    last_ping_ms = 0;
    last_error = reason;
    if (should_retry) {
      scheduleReconnect(now_ms);
    } else {
      next_connect_ms = now_ms;
      retry_delay_ms = CLOUD_RETRY_MIN_MS;
    }
  }

  bool fetchTicket(const CloudConfigValue& config, String& ws_ticket) {
    NetworkClientSecure client;
    client.setInsecure();
    client.setTimeout(CLOUD_HTTP_TIMEOUT_MS);
    if (!client.connect(CLOUD_RELAY_HOST, CLOUD_RELAY_PORT, CLOUD_HTTP_TIMEOUT_MS)) {
      last_error = "ticket_connect_failed";
      return false;
    }

    const String body = makeTicketRequestBody(config);
    const String request =
      String("POST ") + CLOUD_RELAY_TICKET_PATH + " HTTP/1.1\r\n" +
      "Host: " + CLOUD_RELAY_HOST + "\r\n" +
      "Connection: close\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: " + String(body.length()) + "\r\n\r\n" +
      body;
    if (!writeAll(client, request)) {
      client.stop();
      last_error = "ticket_write_failed";
      return false;
    }

    String response_headers;
    String response_body;
    if (!readHttpResponse(client, response_headers, response_body)) {
      client.stop();
      last_error = "ticket_response_failed";
      return false;
    }
    client.stop();

    const int first_line_end = response_headers.indexOf("\r\n");
    if (first_line_end < 0) {
      last_error = "ticket_bad_status_line";
      return false;
    }
    const String status_line = response_headers.substring(0, first_line_end);
    if (!status_line.startsWith("HTTP/1.1 200")) {
      last_error = "ticket_http_not_200";
      return false;
    }
    if (!jsonGetString(response_body, "ws_ticket", ws_ticket)) {
      last_error = "ticket_missing_ws_ticket";
      return false;
    }
    return true;
  }

  bool readHandshakeHeaders(String& response_headers) {
    response_headers = "";
    const unsigned long started_at = millis();
    while (millis() - started_at < CLOUD_CONNECT_TIMEOUT_MS) {
      while (socket.available() > 0) {
        const char c = static_cast<char>(socket.read());
        response_headers += c;
        if (response_headers.endsWith("\r\n\r\n")) {
          return true;
        }
      }
      if (!socket.connected()) {
        return false;
      }
      delay(1);
    }
    return false;
  }

  bool connectWebSocket(const CloudConfigValue& config, const String& ws_ticket) {
    socket.stop();
    socket.setInsecure();
    socket.setTimeout(CLOUD_CONNECT_TIMEOUT_MS);
    if (!socket.connect(CLOUD_RELAY_HOST, CLOUD_RELAY_PORT, CLOUD_CONNECT_TIMEOUT_MS)) {
      last_error = "ws_tcp_connect_failed";
      return false;
    }

    uint8_t nonce[16];
    for (size_t index = 0; index < sizeof(nonce); index++) {
      nonce[index] = static_cast<uint8_t>(esp_random() & 0xff);
    }
    const String sec_websocket_key = base64::encode(nonce, sizeof(nonce));
    const String request =
      String("GET ") + CLOUD_RELAY_PIPE_PATH + "?ticket=" + urlEncode(ws_ticket) + " HTTP/1.1\r\n" +
      "Host: " + CLOUD_RELAY_HOST + "\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: " + sec_websocket_key + "\r\n\r\n";
    if (!writeAll(socket, request)) {
      last_error = "ws_handshake_write_failed";
      socket.stop();
      return false;
    }

    String response_headers;
    if (!readHandshakeHeaders(response_headers)) {
      last_error = "ws_handshake_timeout";
      socket.stop();
      return false;
    }

    const int first_line_end = response_headers.indexOf("\r\n");
    if (first_line_end < 0) {
      last_error = "ws_bad_status_line";
      socket.stop();
      return false;
    }
    const String status_line = response_headers.substring(0, first_line_end);
    if (!status_line.startsWith("HTTP/1.1 101")) {
      last_error = "ws_status_not_101";
      socket.stop();
      return false;
    }

    const String accept_header = findHeaderValue(response_headers, "Sec-WebSocket-Accept");
    if (accept_header.isEmpty()) {
      last_error = "ws_missing_accept";
      socket.stop();
      return false;
    }
    if (accept_header != makeExpectedAccept(sec_websocket_key)) {
      last_error = "ws_bad_accept";
      socket.stop();
      return false;
    }

    connected = true;
    active_boat_id = config.boat_id;
    active_cloud_secret = config.cloud_secret;
    rx_buffer.clear();
    last_ping_ms = millis();
    last_error = "";
    return true;
  }

  bool ensureConnected(unsigned long now_ms, bool wlan_connected, const CloudConfigValue& config) {
    if (!wlan_connected || !config.secret_configured || config.boat_id.isEmpty() || config.cloud_secret.isEmpty()) {
      disconnect("cloud_disabled", now_ms, false);
      return false;
    }

    if (!connected && !cloud_sessions.empty()) {
      disconnect(last_error.isEmpty() ? "cloud_socket_closed" : last_error, now_ms, true);
      return false;
    }

    if (connected) {
      if (!socket.connected()) {
        disconnect("cloud_socket_closed", now_ms, true);
        return false;
      }
      if (!credentialsMatch(config)) {
        disconnect("cloud_credentials_changed", now_ms, true);
        return false;
      }
      return true;
    }

    if (now_ms < next_connect_ms) {
      return false;
    }

    String ws_ticket;
    if (!fetchTicket(config, ws_ticket)) {
      scheduleReconnect(now_ms);
      return false;
    }
    if (!connectWebSocket(config, ws_ticket)) {
      scheduleReconnect(now_ms);
      return false;
    }
    resetRetryBackoff(now_ms);
    return true;
  }

  bool sendFrame(uint8_t opcode, const uint8_t* payload, size_t length) {
    if (!connected) {
      return false;
    }

    std::vector<uint8_t> frame;
    frame.reserve(14U + length);
    frame.push_back(static_cast<uint8_t>(0x80U | (opcode & 0x0fU)));

    if (length < 126U) {
      frame.push_back(static_cast<uint8_t>(0x80U | length));
    } else if (length <= 0xffffU) {
      frame.push_back(0x80U | 126U);
      frame.push_back(static_cast<uint8_t>((length >> 8) & 0xffU));
      frame.push_back(static_cast<uint8_t>(length & 0xffU));
    } else {
      frame.push_back(0x80U | 127U);
      for (int shift = 56; shift >= 0; shift -= 8) {
        frame.push_back(static_cast<uint8_t>((static_cast<uint64_t>(length) >> shift) & 0xffU));
      }
    }

    uint8_t mask[4];
    for (uint8_t& value : mask) {
      value = static_cast<uint8_t>(esp_random() & 0xff);
      frame.push_back(value);
    }

    for (size_t index = 0; index < length; index++) {
      frame.push_back(payload[index] ^ mask[index % 4U]);
    }

    if (!writeAll(socket, frame.data(), frame.size())) {
      last_error = "cloud_write_failed";
      socket.stop();
      connected = false;
      return false;
    }
    return true;
  }

  bool sendTextFrame(const String& message) {
    return sendFrame(0x1U, reinterpret_cast<const uint8_t*>(message.c_str()), message.length());
  }

  bool sendPongFrame(const uint8_t* payload, size_t length) {
    return sendFrame(0xAU, payload, length);
  }

  void handleTransportEnvelope(const String& raw, unsigned long now_ms) {
    String kind;
    if (!jsonGetString(raw, "kind", kind)) {
      disconnect("cloud_invalid_envelope", now_ms, true);
      return;
    }

    if (kind == TRANSPORT_KIND_OPEN) {
      String cloud_conn_id;
      if (!jsonGetString(raw, "cloud_conn_id", cloud_conn_id) || containsString(cloud_sessions, cloud_conn_id)) {
        disconnect("cloud_invalid_open", now_ms, true);
        return;
      }
      cloud_sessions.push_back(cloud_conn_id);
      if (listener != nullptr) {
        listener->onCloudSessionOpened(cloud_conn_id);
      }
      return;
    }

    if (kind == TRANSPORT_KIND_CLOSE) {
      String cloud_conn_id;
      if (!jsonGetString(raw, "cloud_conn_id", cloud_conn_id) || !containsString(cloud_sessions, cloud_conn_id)) {
        disconnect("cloud_invalid_close", now_ms, true);
        return;
      }
      String reason = "closed_by_relay";
      jsonGetString(raw, "reason", reason);
      eraseString(cloud_sessions, cloud_conn_id);
      notifySessionClosed(cloud_conn_id, reason);
      return;
    }

    if (kind == TRANSPORT_KIND_PAYLOAD) {
      String cloud_conn_id;
      String payload_raw;
      if (!jsonGetString(raw, "cloud_conn_id", cloud_conn_id) ||
          !containsString(cloud_sessions, cloud_conn_id) ||
          !jsonFindObjectFieldRaw(raw, "payload", payload_raw)) {
        disconnect("cloud_invalid_payload", now_ms, true);
        return;
      }
      if (listener != nullptr) {
        listener->onCloudSessionPayload(cloud_conn_id, payload_raw);
      }
      return;
    }

    disconnect("cloud_unknown_kind", now_ms, true);
  }

  bool tryProcessNextFrame(unsigned long now_ms) {
    if (rx_buffer.size() < 2U) {
      return false;
    }

    const uint8_t first = rx_buffer[0];
    const uint8_t second = rx_buffer[1];
    const bool fin = (first & 0x80U) != 0;
    const uint8_t opcode = first & 0x0fU;
    const bool masked = (second & 0x80U) != 0;
    uint64_t payload_length = second & 0x7fU;
    size_t offset = 2U;

    if (!fin) {
      disconnect("cloud_fragmented_frame", now_ms, true);
      return false;
    }

    if (payload_length == 126U) {
      if (rx_buffer.size() < offset + 2U) {
        return false;
      }
      payload_length = (static_cast<uint64_t>(rx_buffer[offset]) << 8) | static_cast<uint64_t>(rx_buffer[offset + 1U]);
      offset += 2U;
    } else if (payload_length == 127U) {
      if (rx_buffer.size() < offset + 8U) {
        return false;
      }
      payload_length = 0;
      for (size_t index = 0; index < 8U; index++) {
        payload_length = (payload_length << 8) | static_cast<uint64_t>(rx_buffer[offset + index]);
      }
      offset += 8U;
    }

    uint8_t mask[4] = {0, 0, 0, 0};
    if (masked) {
      if (rx_buffer.size() < offset + 4U) {
        return false;
      }
      for (size_t index = 0; index < 4U; index++) {
        mask[index] = rx_buffer[offset + index];
      }
      offset += 4U;
    }

    if (rx_buffer.size() < offset || payload_length > rx_buffer.size() - offset) {
      return false;
    }

    std::vector<uint8_t> payload(static_cast<size_t>(payload_length));
    for (size_t index = 0; index < payload.size(); index++) {
      uint8_t value = rx_buffer[offset + index];
      if (masked) {
        value ^= mask[index % 4U];
      }
      payload[index] = value;
    }
    rx_buffer.erase(rx_buffer.begin(), rx_buffer.begin() + offset + payload.size());

    if (opcode == 0x1U) {
      String raw(reinterpret_cast<const char*>(payload.data()), payload.size());
      handleTransportEnvelope(raw, now_ms);
      return true;
    }

    if (opcode == 0x8U) {
      disconnect("cloud_close_frame", now_ms, true);
      return false;
    }

    if (opcode == 0x9U) {
      if (!sendPongFrame(payload.data(), payload.size())) {
        disconnect("cloud_pong_failed", now_ms, true);
      }
      return true;
    }

    if (opcode == 0xAU) {
      return true;
    }

    disconnect("cloud_unsupported_frame", now_ms, true);
    return false;
  }

  void readFrames(unsigned long now_ms) {
    while (socket.available() > 0) {
      uint8_t chunk[256];
      const int read_count = socket.read(chunk, sizeof(chunk));
      if (read_count <= 0) {
        break;
      }
      rx_buffer.insert(rx_buffer.end(), chunk, chunk + read_count);
    }

    while (connected && tryProcessNextFrame(now_ms)) {
    }

    if (connected && !socket.connected() && socket.available() == 0) {
      disconnect("cloud_socket_closed", now_ms, true);
    }
  }
};

CloudTransport::CloudTransport() : impl_(new Impl()) {}

void CloudTransport::begin(CloudTransportListener* listener) {
  impl_->begin(listener);
}

void CloudTransport::loop(unsigned long now_ms, bool wlan_connected, const CloudConfigValue& config) {
  if (!impl_->ensureConnected(now_ms, wlan_connected, config)) {
    return;
  }

  impl_->readFrames(now_ms);
  if (!impl_->connected) {
    return;
  }

  if (now_ms - impl_->last_ping_ms >= CLOUD_PING_INTERVAL_MS) {
    if (!impl_->sendFrame(0x9U, nullptr, 0U)) {
      impl_->disconnect("cloud_ping_failed", now_ms, true);
      return;
    }
    impl_->last_ping_ms = now_ms;
  }
}

bool CloudTransport::sendPayload(const String& cloud_conn_id, const String& payload_json) {
  if (!impl_->connected || !containsString(impl_->cloud_sessions, cloud_conn_id)) {
    return false;
  }
  return impl_->sendTextFrame(buildPayloadEnvelope(cloud_conn_id, payload_json));
}

bool CloudTransport::isConnected() const {
  return impl_->connected;
}

String CloudTransport::lastError() const {
  return impl_->last_error;
}

}  // namespace aw
