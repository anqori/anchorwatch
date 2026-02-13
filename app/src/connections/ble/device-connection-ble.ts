import {
  BLE_AUTH_UUID,
  BLE_CHUNK_TIMEOUT_MS,
  BLE_CONTROL_TX_UUID,
  BLE_EVENT_RX_UUID,
  BLE_SERVICE_UUID,
  BLE_SNAPSHOT_UUID,
  PROTOCOL_VERSION,
} from "../../core/constants";
import type { Envelope, InboundSource, JsonRecord, PendingAck, TrackPoint, WifiScanNetwork } from "../../core/types";
import { connectBleWithCharacteristics, disconnectBleDevice } from "./ble-connection";
import {
  clearPendingAcks,
  consumeChunkedBleFrame,
  makeAckPromise,
  resolvePendingAckFromPayload,
} from "./ble-session";
import { makeMsgId, writeChunked } from "./ble-transport";
import { dataViewToBytes, isObject, parseTrackSnapshot, parseWifiScanNetworks, safeParseJson } from "../../services/data-utils";
import { buildConfigPatchPayload, buildProtocolEnvelope, type ConfigPatchCommand } from "../../services/protocol-messages";
import { readAlertRuntimeEntries } from "../../services/state-derive";
import { ensurePhoneId, getBoatId } from "../../services/persistence-domain";
import type {
  DeviceConnection,
  DeviceCommandResult,
  DeviceEvent,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
} from "../device-connection";

interface BleTransportState {
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  service: BluetoothRemoteGATTService | null;
  controlTx: BluetoothRemoteGATTCharacteristic | null;
  eventRx: BluetoothRemoteGATTCharacteristic | null;
  snapshot: BluetoothRemoteGATTCharacteristic | null;
  auth: BluetoothRemoteGATTCharacteristic | null;
  connected: boolean;
  seq: number;
  pendingAcks: Map<string, PendingAck>;
  chunkAssemblies: Map<string, { partCount: number; parts: Array<string | null>; updatedAt: number }>;
  authState: JsonRecord | null;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface PendingSnapshotRequest {
  resolve: (snapshot: JsonRecord | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingTrackRequest {
  resolve: (points: TrackPoint[] | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DeviceConnectionBle implements DeviceConnection {
  readonly kind = "bluetooth" as const;

  private state: BleTransportState = {
    device: null,
    server: null,
    service: null,
    controlTx: null,
    eventRx: null,
    snapshot: null,
    auth: null,
    connected: false,
    seq: 1,
    pendingAcks: new Map(),
    chunkAssemblies: new Map(),
    authState: null,
  };

  private eventSubscribers = new Set<(event: DeviceEvent) => void>();

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private pendingSnapshots: PendingSnapshotRequest[] = [];

  private pendingTracks: PendingTrackRequest[] = [];

  async connect(): Promise<void> {
    if (this.state.connected) {
      return;
    }

    const {
      device,
      server,
      service,
      controlTx,
      eventRx,
      snapshot,
      auth,
    } = await connectBleWithCharacteristics({
      serviceUuid: BLE_SERVICE_UUID,
      controlTxUuid: BLE_CONTROL_TX_UUID,
      eventRxUuid: BLE_EVENT_RX_UUID,
      snapshotUuid: BLE_SNAPSHOT_UUID,
      authUuid: BLE_AUTH_UUID,
      onDisconnected: this.onBleDisconnected as EventListener,
      onNotification: this.onBleNotification as EventListener,
    });

    this.state.device = device;
    this.state.server = server;
    this.state.service = service;
    this.state.controlTx = controlTx;
    this.state.eventRx = eventRx;
    this.state.snapshot = snapshot;
    this.state.auth = auth;
    this.state.connected = true;
    this.state.chunkAssemblies.clear();

    await this.refreshAuthState();
    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    if (disconnectBleDevice(this.state.device)) {
      return;
    }
    this.handleDisconnectedState();
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  subscribeEvents(callback: (event: DeviceEvent) => void): () => void {
    this.eventSubscribers.add(callback);
    return () => {
      this.eventSubscribers.delete(callback);
    };
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
    await this.sendBleCommand("config.patch", buildConfigPatchPayload(command), true);
  }

  async commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]> {
    const requestId = `wifi-${makeMsgId()}`;
    const ack = await this.sendBleCommand("onboarding.wifi.scan", {
      requestId,
      maxResults,
      includeHidden,
    }, true);
    return parseWifiScanNetworks(ack?.networks);
  }

  async commandAnchorRise(): Promise<DeviceCommandResult> {
    const ack = await this.sendBleCommand("anchor.rise", {}, true);
    return this.parseCommandResult(ack);
  }

  async commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult> {
    const ack = await this.sendBleCommand("anchor.down", { lat, lon }, true);
    return this.parseCommandResult(ack);
  }

  async commandAlarmSilence(seconds: number): Promise<DeviceCommandResult> {
    const silenceForMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.floor(seconds * 1000)));
    const ack = await this.sendBleCommand("alarm.silence.request", { silenceForMs }, true);
    return this.parseCommandResult(ack);
  }

  private async sendBleCommand(msgType: string, payload: JsonRecord, requiresAck = true): Promise<JsonRecord | null> {
    if (!this.state.connected || !this.state.controlTx) {
      throw new Error("BLE not connected");
    }

    const envelope = buildProtocolEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      msgType,
      msgId: makeMsgId(),
      boatId: getBoatId() || "boat_unknown",
      deviceId: ensurePhoneId(),
      seq: this.state.seq++,
      requiresAck,
      payload,
    });

    const raw = JSON.stringify(envelope);
    const ackPromise = requiresAck && envelope.msgId
      ? makeAckPromise(this.state.pendingAcks, envelope.msgId)
      : null;

    try {
      await writeChunked(this.state.controlTx, envelope.msgId as string, raw, encoder);
      if (!ackPromise) {
        return null;
      }
      return await ackPromise;
    } catch (error) {
      if (envelope.msgId) {
        this.state.pendingAcks.delete(envelope.msgId);
      }
      throw error;
    }
  }

  private parseCommandResult(ack: JsonRecord | null): DeviceCommandResult {
    const rawStatus = typeof ack?.status === "string" ? ack.status.trim() : "";
    if (rawStatus === "ok" || rawStatus === "accepted" || rawStatus === "failed" || rawStatus === "rejected") {
      const errorCode = typeof ack?.errorCode === "string" && ack.errorCode.trim() ? ack.errorCode : null;
      const errorDetail = typeof ack?.errorDetail === "string" && ack.errorDetail.trim() ? ack.errorDetail : null;
      return {
        accepted: rawStatus === "ok" || rawStatus === "accepted",
        status: rawStatus,
        errorCode,
        errorDetail,
      };
    }
    return {
      accepted: true,
      status: "ok",
      errorCode: null,
      errorDetail: null,
    };
  }

  async requestStateSnapshot(): Promise<JsonRecord | null> {
    if (!this.state.connected) {
      throw new Error("BLE not connected");
    }

    const snapshotPromise = new Promise<JsonRecord | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSnapshots = this.pendingSnapshots.filter((entry) => entry !== pending);
        resolve(null);
      }, 3500);
      const pending: PendingSnapshotRequest = { resolve, reject, timeout };
      this.pendingSnapshots.push(pending);
    });

    await this.sendBleCommand("status.snapshot.request", {}, false);
    return snapshotPromise;
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    if (!this.state.connected) {
      throw new Error("BLE not connected");
    }

    const trackPromise = new Promise<TrackPoint[] | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTracks = this.pendingTracks.filter((entry) => entry !== pending);
        resolve(null);
      }, 4500);
      const pending: PendingTrackRequest = { resolve, reject, timeout };
      this.pendingTracks.push(pending);
    });

    await this.sendBleCommand("track.snapshot.request", { limit: Math.max(1, Math.floor(limit)) }, false);
    return trackPromise;
  }

  async probe(): Promise<DeviceConnectionProbeResult> {
    if (this.state.connected) {
      return {
        ok: true,
        resultText: "BLE connected",
        buildVersion: null,
      };
    }
    return {
      ok: false,
      resultText: "BLE disconnected",
      buildVersion: null,
    };
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.state.connected,
      deviceName: this.state.device?.name?.trim() || "",
      authState: this.state.authState,
    };
  }

  private emitStatus(): void {
    const status = this.currentStatus();
    for (const subscriber of this.statusSubscribers) {
      subscriber(status);
    }
  }

  private emitEvent(event: DeviceEvent): void {
    for (const subscriber of this.eventSubscribers) {
      subscriber(event);
    }
  }

  private async refreshAuthState(): Promise<void> {
    if (!this.state.connected || !this.state.auth) {
      this.state.authState = null;
      return;
    }

    try {
      const value = await this.state.auth.readValue();
      const raw = decoder.decode(dataViewToBytes(value));
      const parsed = safeParseJson(raw);
      this.state.authState = isObject(parsed) ? parsed : null;
    } catch {
      this.state.authState = null;
    }
  }

  private handleCommandAck(payload: JsonRecord): void {
    resolvePendingAckFromPayload(this.state.pendingAcks, payload);
  }

  private handleIncomingEnvelope(envelope: Envelope, source: InboundSource): void {
    if (envelope.msgType === "command.ack") {
      const payload = isObject(envelope.payload) ? envelope.payload : {};
      this.handleCommandAck(payload);
      return;
    }
    const event = this.toDeviceEvent(envelope, source);
    if (!event) {
      return;
    }

    if (event.type === "state.snapshot" && isObject(event.snapshot)) {
      const pending = this.pendingSnapshots.shift();
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(event.snapshot);
      }
    }

    if (event.type === "track.snapshot") {
      const pending = this.pendingTracks.shift();
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(event.points);
      }
    }

    this.emitEvent(event);
  }

  private toDeviceEvent(envelope: Envelope, source: InboundSource): DeviceEvent | null {
    const boatId = typeof envelope.boatId === "string" && envelope.boatId ? envelope.boatId : undefined;
    const payload: JsonRecord = isObject(envelope.payload) ? envelope.payload : {};
    const msgType = typeof envelope.msgType === "string" && envelope.msgType ? envelope.msgType : "unknown";

    if (msgType === "command.ack") {
      return null;
    }
    if (msgType === "status.patch") {
      return {
        type: "state.patch",
        source,
        boatId,
        patch: payload.statePatch,
      };
    }
    if (msgType === "status.snapshot") {
      return {
        type: "state.snapshot",
        source,
        boatId,
        snapshot: payload.snapshot,
      };
    }
    if (msgType === "onboarding.boat_secret") {
      return {
        type: "onboarding.boatSecret",
        source,
        boatId,
        onboardingBoatId: typeof payload.boatId === "string" ? payload.boatId : undefined,
        boatSecret: typeof payload.boatSecret === "string" ? payload.boatSecret : undefined,
      };
    }
    if (msgType === "track.snapshot") {
      return {
        type: "track.snapshot",
        source,
        boatId,
        points: parseTrackSnapshot(payload),
      };
    }
    if (msgType === "alerts.state" || msgType === "alarm.state") {
      const alertsPayload = isObject(payload.alerts) ? payload.alerts : payload;
      return {
        type: "alerts.state",
        source,
        boatId,
        alerts: readAlertRuntimeEntries({ alerts: alertsPayload }),
      };
    }
    return {
      type: "unknown",
      source,
      boatId,
      msgType,
      payload,
    };
  }

  private onBleNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null;
    const value = characteristic?.value;
    if (!value) {
      return;
    }

    const bytes = dataViewToBytes(value);
    if (!bytes.length) {
      return;
    }

    if (bytes[0] === 0x7b) {
      const parsed = safeParseJson(decoder.decode(bytes));
      if (!parsed || !isObject(parsed)) {
        return;
      }
      this.handleIncomingEnvelope(parsed as Envelope, "ble/eventRx");
      return;
    }

    const frame = consumeChunkedBleFrame(
      this.state.chunkAssemblies,
      bytes,
      (chunk) => decoder.decode(chunk),
      BLE_CHUNK_TIMEOUT_MS,
    );
    if (frame.kind !== "complete" || !frame.raw) {
      return;
    }

    const parsed = safeParseJson(frame.raw);
    if (!parsed || !isObject(parsed)) {
      return;
    }
    this.handleIncomingEnvelope(parsed as Envelope, "ble/eventRx");
  };

  private onBleDisconnected = (): void => {
    this.handleDisconnectedState();
  };

  private handleDisconnectedState(): void {
    const previousDevice = this.state.device;
    const previousEventRx = this.state.eventRx;

    if (previousEventRx) {
      previousEventRx.removeEventListener("characteristicvaluechanged", this.onBleNotification as EventListener);
    }
    if (previousDevice) {
      previousDevice.removeEventListener("gattserverdisconnected", this.onBleDisconnected as EventListener);
    }

    this.state.connected = false;
    this.state.device = null;
    this.state.server = null;
    this.state.service = null;
    this.state.controlTx = null;
    this.state.eventRx = null;
    this.state.snapshot = null;
    this.state.auth = null;
    this.state.authState = null;
    this.state.chunkAssemblies.clear();

    clearPendingAcks(this.state.pendingAcks, "BLE disconnected");
    for (const pending of this.pendingSnapshots) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("BLE disconnected"));
    }
    this.pendingSnapshots = [];
    for (const pending of this.pendingTracks) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("BLE disconnected"));
    }
    this.pendingTracks = [];
    this.emitStatus();
  }
}
