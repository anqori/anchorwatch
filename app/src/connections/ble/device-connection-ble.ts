import {
  BLE_AUTH_UUID,
  BLE_CHUNK_TIMEOUT_MS,
  BLE_CONTROL_TX_UUID,
  BLE_EVENT_RX_UUID,
  BLE_SERVICE_UUID,
  BLE_SNAPSHOT_UUID,
  PROTOCOL_VERSION,
} from "../../core/constants";
import type { Envelope, InboundSource, JsonRecord, PendingAck, TrackPoint } from "../../core/types";
import { connectBleWithCharacteristics, disconnectBleDevice } from "./ble-connection";
import {
  clearPendingAcks,
  consumeChunkedBleFrame,
  makeAckPromise,
  resolvePendingAckFromPayload,
} from "./ble-session";
import { makeMsgId, writeChunked } from "./ble-transport";
import { dataViewToBytes, isObject, safeParseJson } from "../../services/data-utils";
import { buildConfigPatchPayload, buildProtocolEnvelope, type ConfigPatchCommand } from "../../services/protocol-messages";
import { ensurePhoneId, getBoatId } from "../../services/persistence-domain";
import type { DeviceConnection, DeviceConnectionProbeResult, DeviceConnectionStatus } from "../device-connection";

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

  private envelopeSubscribers = new Set<(envelope: Envelope, source: InboundSource) => void>();

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

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

  subscribeEnvelope(callback: (envelope: Envelope, source: InboundSource) => void): () => void {
    this.envelopeSubscribers.add(callback);
    return () => {
      this.envelopeSubscribers.delete(callback);
    };
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  async sendCommand(msgType: string, payload: JsonRecord, requiresAck = true): Promise<JsonRecord | null> {
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

  async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
    await this.sendCommand("config.patch", buildConfigPatchPayload(command), true);
  }

  async requestStateSnapshot(): Promise<JsonRecord | null> {
    if (!this.state.connected || !this.state.snapshot) {
      throw new Error("BLE snapshot characteristic unavailable");
    }

    const value = await this.state.snapshot.readValue();
    const raw = decoder.decode(dataViewToBytes(value));
    const envelope = safeParseJson(raw) as Envelope | null;
    if (!envelope || !isObject(envelope)) {
      throw new Error("invalid snapshot JSON");
    }

    this.emitEnvelope(envelope, "ble/snapshot");

    if (envelope.msgType !== "status.snapshot") {
      return null;
    }
    const payload = isObject(envelope.payload) ? envelope.payload : {};
    return isObject(payload.snapshot) ? payload.snapshot : null;
  }

  async requestTrackSnapshot(_limit: number): Promise<TrackPoint[] | null> {
    return null;
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

  private emitEnvelope(envelope: Envelope, source: InboundSource): void {
    for (const subscriber of this.envelopeSubscribers) {
      subscriber(envelope, source);
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
    this.emitEnvelope(envelope, source);
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
    this.emitStatus();
  }
}
