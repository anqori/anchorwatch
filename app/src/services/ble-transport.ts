import { BLE_CHUNK_MAX_PAYLOAD } from "../core/constants";
import { fnv1a32 } from "./data-utils";

export function makeMsgId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`.slice(0, 24);
}

export async function writeCharacteristic(
  characteristic: BluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array,
): Promise<void> {
  const payload = new Uint8Array(bytes);
  const candidate = characteristic as BluetoothRemoteGATTCharacteristic & {
    writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  };

  if (typeof candidate.writeValueWithoutResponse === "function") {
    await candidate.writeValueWithoutResponse(payload);
    return;
  }

  await characteristic.writeValue(payload);
}

export async function writeChunked(
  characteristic: BluetoothRemoteGATTCharacteristic,
  msgId: string,
  jsonText: string,
  encoder: TextEncoder,
): Promise<void> {
  const bytes = encoder.encode(jsonText);
  const partCount = Math.max(1, Math.ceil(bytes.length / BLE_CHUNK_MAX_PAYLOAD));
  const msgId32 = fnv1a32(msgId);

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const offset = partIndex * BLE_CHUNK_MAX_PAYLOAD;
    const chunk = bytes.slice(offset, offset + BLE_CHUNK_MAX_PAYLOAD);
    const frame = new Uint8Array(6 + chunk.length);
    frame[0] = msgId32 & 0xff;
    frame[1] = (msgId32 >>> 8) & 0xff;
    frame[2] = (msgId32 >>> 16) & 0xff;
    frame[3] = (msgId32 >>> 24) & 0xff;
    frame[4] = partIndex & 0xff;
    frame[5] = partCount & 0xff;
    frame.set(chunk, 6);
    await writeCharacteristic(characteristic, frame);
  }
}
