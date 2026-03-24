#include "aw_json.h"

#include <stdlib.h>

namespace aw {

namespace {

void skipWhitespace(const String& input, size_t& index) {
  while (index < input.length()) {
    const char c = input.charAt(index);
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
      break;
    }
    index++;
  }
}

bool scanStringToken(const String& input, size_t& index) {
  if (index >= input.length() || input.charAt(index) != '"') {
    return false;
  }
  index++;
  while (index < input.length()) {
    const char c = input.charAt(index);
    if (c == '\\') {
      index += 2;
      continue;
    }
    index++;
    if (c == '"') {
      return true;
    }
  }
  return false;
}

bool scanCompoundToken(const String& input, size_t& index, char open_char, char close_char) {
  if (index >= input.length() || input.charAt(index) != open_char) {
    return false;
  }
  int depth = 0;
  while (index < input.length()) {
    const char c = input.charAt(index);
    if (c == '"') {
      if (!scanStringToken(input, index)) {
        return false;
      }
      continue;
    }
    if (c == open_char) {
      depth++;
    } else if (c == close_char) {
      depth--;
      index++;
      if (depth == 0) {
        return true;
      }
      continue;
    }
    index++;
  }
  return false;
}

bool scanPrimitiveToken(const String& input, size_t& index) {
  while (index < input.length()) {
    const char c = input.charAt(index);
    if (c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\r' || c == '\n') {
      return true;
    }
    index++;
  }
  return true;
}

bool scanJsonValue(const String& input, size_t& index) {
  skipWhitespace(input, index);
  if (index >= input.length()) {
    return false;
  }
  const char c = input.charAt(index);
  if (c == '"') {
    return scanStringToken(input, index);
  }
  if (c == '{') {
    return scanCompoundToken(input, index, '{', '}');
  }
  if (c == '[') {
    return scanCompoundToken(input, index, '[', ']');
  }
  return scanPrimitiveToken(input, index);
}

bool readObjectField(const String& object, const char* key, String& raw) {
  size_t index = 0;
  skipWhitespace(object, index);
  if (index >= object.length() || object.charAt(index) != '{') {
    return false;
  }
  index++;

  while (index < object.length()) {
    skipWhitespace(object, index);
    if (index >= object.length()) {
      return false;
    }
    if (object.charAt(index) == '}') {
      return false;
    }

    const size_t key_start = index;
    if (!scanStringToken(object, index)) {
      return false;
    }
    const String key_raw = object.substring(key_start, index);
    String parsed_key;
    if (!jsonDecodeStringLiteral(key_raw, parsed_key)) {
      return false;
    }

    skipWhitespace(object, index);
    if (index >= object.length() || object.charAt(index) != ':') {
      return false;
    }
    index++;
    skipWhitespace(object, index);
    const size_t value_start = index;
    if (!scanJsonValue(object, index)) {
      return false;
    }
    const String value_raw = object.substring(value_start, index);
    if (parsed_key == key) {
      raw = jsonTrim(value_raw);
      return true;
    }

    skipWhitespace(object, index);
    if (index >= object.length()) {
      return false;
    }
    if (object.charAt(index) == ',') {
      index++;
      continue;
    }
    if (object.charAt(index) == '}') {
      return false;
    }
    return false;
  }

  return false;
}

}  // namespace

bool jsonFindObjectFieldRaw(const String& object, const char* key, String& raw) {
  return readObjectField(object, key, raw);
}

bool jsonDecodeStringLiteral(const String& raw, String& out) {
  if (raw.length() < 2 || raw.charAt(0) != '"' || raw.charAt(raw.length() - 1) != '"') {
    return false;
  }
  out = "";
  out.reserve(raw.length());
  for (size_t index = 1; index + 1 < raw.length(); index++) {
    const char c = raw.charAt(index);
    if (c != '\\') {
      out += c;
      continue;
    }
    if (index + 1 >= raw.length() - 1) {
      return false;
    }
    index++;
    const char escaped = raw.charAt(index);
    switch (escaped) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      default: return false;
    }
  }
  return true;
}

bool jsonGetString(const String& object, const char* key, String& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  return jsonDecodeStringLiteral(raw, out);
}

bool jsonGetBool(const String& object, const char* key, bool& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  raw = jsonTrim(raw);
  if (raw == "true") {
    out = true;
    return true;
  }
  if (raw == "false") {
    out = false;
    return true;
  }
  return false;
}

bool jsonGetFloat(const String& object, const char* key, float& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  raw = jsonTrim(raw);
  char* end_ptr = nullptr;
  const double value = strtod(raw.c_str(), &end_ptr);
  if (end_ptr == raw.c_str() || *end_ptr != '\0') {
    return false;
  }
  out = static_cast<float>(value);
  return true;
}

bool jsonGetUint32(const String& object, const char* key, uint32_t& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  raw = jsonTrim(raw);
  char* end_ptr = nullptr;
  const unsigned long value = strtoul(raw.c_str(), &end_ptr, 10);
  if (end_ptr == raw.c_str() || *end_ptr != '\0') {
    return false;
  }
  out = static_cast<uint32_t>(value);
  return true;
}

bool jsonGetUint64(const String& object, const char* key, uint64_t& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  raw = jsonTrim(raw);
  char* end_ptr = nullptr;
  const unsigned long long value = strtoull(raw.c_str(), &end_ptr, 10);
  if (end_ptr == raw.c_str() || *end_ptr != '\0') {
    return false;
  }
  out = static_cast<uint64_t>(value);
  return true;
}

bool jsonGetInt32(const String& object, const char* key, int32_t& out) {
  String raw;
  if (!jsonFindObjectFieldRaw(object, key, raw)) {
    return false;
  }
  raw = jsonTrim(raw);
  char* end_ptr = nullptr;
  const long value = strtol(raw.c_str(), &end_ptr, 10);
  if (end_ptr == raw.c_str() || *end_ptr != '\0') {
    return false;
  }
  out = static_cast<int32_t>(value);
  return true;
}

bool jsonSplitArrayItems(const String& array_raw, std::vector<String>& items) {
  items.clear();
  size_t index = 0;
  skipWhitespace(array_raw, index);
  if (index >= array_raw.length() || array_raw.charAt(index) != '[') {
    return false;
  }
  index++;
  while (index < array_raw.length()) {
    skipWhitespace(array_raw, index);
    if (index >= array_raw.length()) {
      return false;
    }
    if (array_raw.charAt(index) == ']') {
      return true;
    }
    const size_t value_start = index;
    if (!scanJsonValue(array_raw, index)) {
      return false;
    }
    items.push_back(jsonTrim(array_raw.substring(value_start, index)));
    skipWhitespace(array_raw, index);
    if (index >= array_raw.length()) {
      return false;
    }
    if (array_raw.charAt(index) == ',') {
      index++;
      continue;
    }
    if (array_raw.charAt(index) == ']') {
      return true;
    }
    return false;
  }
  return false;
}

bool jsonIsNull(const String& raw) {
  return jsonTrim(raw) == "null";
}

bool jsonReplaceObjectFieldRaw(const String& object, const char* key, const String& replacement_raw, String& out) {
  size_t index = 0;
  skipWhitespace(object, index);
  if (index >= object.length() || object.charAt(index) != '{') {
    return false;
  }
  index++;
  while (index < object.length()) {
    skipWhitespace(object, index);
    if (index >= object.length() || object.charAt(index) == '}') {
      return false;
    }
    const size_t key_start = index;
    if (!scanStringToken(object, index)) {
      return false;
    }
    const String key_raw = object.substring(key_start, index);
    String parsed_key;
    if (!jsonDecodeStringLiteral(key_raw, parsed_key)) {
      return false;
    }
    skipWhitespace(object, index);
    if (index >= object.length() || object.charAt(index) != ':') {
      return false;
    }
    index++;
    skipWhitespace(object, index);
    const size_t value_start = index;
    if (!scanJsonValue(object, index)) {
      return false;
    }
    const size_t value_end = index;
    if (parsed_key == key) {
      out = object.substring(0, value_start) + replacement_raw + object.substring(value_end);
      return true;
    }
    skipWhitespace(object, index);
    if (index >= object.length()) {
      return false;
    }
    if (object.charAt(index) == ',') {
      index++;
      continue;
    }
    if (object.charAt(index) == '}') {
      return false;
    }
    return false;
  }
  return false;
}

String jsonEscape(const String& value) {
  String out;
  out.reserve(value.length() + 8);
  for (size_t index = 0; index < value.length(); index++) {
    const char c = value.charAt(index);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default: out += c; break;
    }
  }
  return out;
}

String jsonQuote(const String& value) {
  return "\"" + jsonEscape(value) + "\"";
}

String jsonBool(bool value) {
  return value ? "true" : "false";
}

String jsonNull() {
  return "null";
}

String jsonU64(uint64_t value) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%llu", static_cast<unsigned long long>(value));
  return String(buffer);
}

String jsonI64(int64_t value) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(value));
  return String(buffer);
}

String jsonFloat(float value, uint8_t digits) {
  if (isnan(value) || isinf(value)) {
    return "0";
  }
  return String(static_cast<double>(value), static_cast<unsigned int>(digits));
}

String jsonTrim(const String& raw) {
  size_t start = 0;
  size_t end = raw.length();
  while (start < end) {
    const char c = raw.charAt(start);
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
      break;
    }
    start++;
  }
  while (end > start) {
    const char c = raw.charAt(end - 1);
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
      break;
    }
    end--;
  }
  return raw.substring(start, end);
}

}  // namespace aw
