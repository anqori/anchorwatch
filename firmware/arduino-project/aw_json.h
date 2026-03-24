#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <vector>

namespace aw {

bool jsonFindObjectFieldRaw(const String& object, const char* key, String& raw);
bool jsonGetString(const String& object, const char* key, String& out);
bool jsonGetBool(const String& object, const char* key, bool& out);
bool jsonGetFloat(const String& object, const char* key, float& out);
bool jsonGetUint32(const String& object, const char* key, uint32_t& out);
bool jsonGetUint64(const String& object, const char* key, uint64_t& out);
bool jsonGetInt32(const String& object, const char* key, int32_t& out);
bool jsonSplitArrayItems(const String& array_raw, std::vector<String>& items);
bool jsonDecodeStringLiteral(const String& raw, String& out);
bool jsonIsNull(const String& raw);
bool jsonReplaceObjectFieldRaw(const String& object, const char* key, const String& replacement_raw, String& out);

String jsonEscape(const String& value);
String jsonQuote(const String& value);
String jsonBool(bool value);
String jsonNull();
String jsonU64(uint64_t value);
String jsonI64(int64_t value);
String jsonFloat(float value, uint8_t digits);
String jsonTrim(const String& raw);

}  // namespace aw
