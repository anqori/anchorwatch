import type { ChunkAssembly, JsonRecord, PendingAck } from "../../core/types";
import { extractAckError } from "../../services/data-utils";

export interface ChunkFrameResult {
  kind: "invalid" | "incomplete" | "complete";
  raw?: string;
}

export function resolvePendingAckFromPayload(pendingAcks: Map<string, PendingAck>, payload: JsonRecord): void {
  const ackForMsgId = typeof payload.ackForMsgId === "string" ? payload.ackForMsgId : "";
  if (!ackForMsgId) {
    return;
  }

  const pending = pendingAcks.get(ackForMsgId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingAcks.delete(ackForMsgId);

  if (payload.status === "ok") {
    pending.resolve(payload);
    return;
  }

  pending.reject(new Error(extractAckError(payload)));
}

export function clearPendingAcks(pendingAcks: Map<string, PendingAck>, reason: string): void {
  for (const pending of pendingAcks.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  pendingAcks.clear();
}

export function makeAckPromise(pendingAcks: Map<string, PendingAck>, msgId: string, timeoutMs = 4500): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAcks.delete(msgId);
      reject(new Error("ACK timeout"));
    }, timeoutMs);
    pendingAcks.set(msgId, { resolve, reject, timeout });
  });
}

export function cleanupChunkAssemblies(chunkAssemblies: Map<string, ChunkAssembly>, timeoutMs: number, nowTs = Date.now()): void {
  for (const [key, entry] of chunkAssemblies.entries()) {
    if (nowTs - entry.updatedAt > timeoutMs) {
      chunkAssemblies.delete(key);
    }
  }
}

export function consumeChunkedBleFrame(
  chunkAssemblies: Map<string, ChunkAssembly>,
  bytes: Uint8Array,
  decodeChunk: (chunk: Uint8Array) => string,
  timeoutMs: number,
  nowTs = Date.now(),
): ChunkFrameResult {
  if (bytes.length < 6) {
    return { kind: "invalid" };
  }

  const msgId32 = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  const partIndex = bytes[4];
  const partCount = bytes[5];
  if (!partCount || partIndex >= partCount) {
    return { kind: "invalid" };
  }

  const key = `${msgId32}:${partCount}`;
  let entry = chunkAssemblies.get(key);
  if (!entry) {
    entry = {
      partCount,
      parts: Array.from({ length: partCount }, () => null),
      updatedAt: nowTs,
    };
    chunkAssemblies.set(key, entry);
  }

  entry.updatedAt = nowTs;
  entry.parts[partIndex] = decodeChunk(bytes.slice(6));

  if (entry.parts.some((part) => part === null)) {
    cleanupChunkAssemblies(chunkAssemblies, timeoutMs, nowTs);
    return { kind: "incomplete" };
  }

  chunkAssemblies.delete(key);
  return {
    kind: "complete",
    raw: entry.parts.join(""),
  };
}
