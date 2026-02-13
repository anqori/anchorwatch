import type { Envelope, InboundSource, JsonRecord, TrackPoint } from "../core/types";
import { isObject, parseTrackSnapshot } from "./data-utils";

export interface BleEnvelopeCallbacks {
  setBoatId: (boatId: string) => void;
  setBoatSecret: (boatSecret: string) => void;
  applyStatePatch: (statePatch: unknown, source: InboundSource) => void;
  applyStateSnapshot: (snapshot: unknown, source: InboundSource) => void;
  applyWifiScanResult: (payload: JsonRecord) => void;
  replaceTrackPoints: (points: TrackPoint[]) => void;
  resolvePendingAck: (payload: JsonRecord) => void;
  markBleMessageSeen: () => void;
  logLine: (message: string) => void;
}

export function handleBleEnvelope(envelope: Envelope, sourceTag: InboundSource, callbacks: BleEnvelopeCallbacks): void {
  if (typeof envelope.boatId === "string" && envelope.boatId) {
    callbacks.setBoatId(envelope.boatId);
  }

  const payload: JsonRecord = isObject(envelope.payload) ? envelope.payload : {};
  const msgType = envelope.msgType || "unknown";

  if (msgType === "command.ack") {
    callbacks.resolvePendingAck(payload);
    return;
  }

  if (msgType === "status.patch") {
    callbacks.applyStatePatch(payload.statePatch, sourceTag);
    callbacks.markBleMessageSeen();
    return;
  }

  if (msgType === "status.snapshot") {
    callbacks.applyStateSnapshot(payload.snapshot, sourceTag);
    callbacks.markBleMessageSeen();
    return;
  }

  if (msgType === "onboarding.boat_secret") {
    if (typeof payload.boatId === "string") {
      callbacks.setBoatId(payload.boatId);
    }
    if (typeof payload.boatSecret === "string" && payload.boatSecret) {
      callbacks.setBoatSecret(payload.boatSecret);
      callbacks.logLine("received onboarding.boat_secret and stored secret");
    } else {
      callbacks.logLine("onboarding.boat_secret missing boatSecret");
    }
    return;
  }

  if (msgType === "onboarding.wifi.scan_result") {
    callbacks.applyWifiScanResult(payload);
    return;
  }

  if (msgType === "track.snapshot") {
    const points = parseTrackSnapshot(payload);
    if (points.length > 0) {
      callbacks.replaceTrackPoints(points);
      callbacks.logLine(`track.snapshot received (${points.length} points)`);
    } else {
      callbacks.logLine("track.snapshot received (no valid points)");
    }
    return;
  }

  callbacks.logLine(`rx ${msgType} (${sourceTag})`);
}
