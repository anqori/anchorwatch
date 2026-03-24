import {
  BLE_AUTH_UUID,
  BLE_CHUNK_TIMEOUT_MS,
  BLE_CONTROL_TX_UUID,
  BLE_EVENT_RX_UUID,
  BLE_SERVICE_UUID,
  BLE_SNAPSHOT_UUID,
  TRACK_MAX_POINTS,
} from "../../core/constants";
import type { InboundSource, JsonRecord, PendingAck, TrackPoint, WifiScanNetwork } from "../../core/types";
import { connectBleWithCharacteristics, disconnectBleDevice, listGrantedBleDevices } from "./ble-connection";
import { consumeChunkedBleFrame } from "./ble-session";
import { makeMsgId, writeChunked } from "./ble-transport";
import {
  applyPartVersions,
  applyUpdateVersion,
  mapProtocolPartToLegacyPatch,
  mapProtocolPartsToLegacyState,
  readProtocolPartUpdate,
  readProtocolSnapshotParts,
  readProtocolTrackAppend,
} from "../../services/protocol-v2-state";
import {
  buildCancelPayload,
  buildCommandEnvelope,
  buildConfigUpdatePayload,
  extractProtocolError,
  makeRequestId,
  type ConfigPartsCommand,
} from "../../services/protocol-messages";
import { dataViewToBytes, deepMerge, isObject, parseWifiScanNetworks, safeParseJson } from "../../services/data-utils";
import {
  getLastBleDeviceId,
  getLastBleDeviceName,
  setLastBleDevice,
} from "../../services/persistence-domain";
import { appendDebugMessage } from "../../state/app-state.svelte";
import type {
  DeviceCommandResult,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
  DeviceEvent,
  DeviceWifiConnectInput,
} from "../device-connection";
import type { DeviceConnectionBleLike } from "./device-connection-ble-like";

interface BleTransportState {
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  service: BluetoothRemoteGATTService | null;
  controlTx: BluetoothRemoteGATTCharacteristic | null;
  eventRx: BluetoothRemoteGATTCharacteristic | null;
  snapshot: BluetoothRemoteGATTCharacteristic | null;
  auth: BluetoothRemoteGATTCharacteristic | null;
  connected: boolean;
  pendingReplies: Map<string, PendingAck>;
  chunkAssemblies: Map<string, { partCount: number; parts: Array<string | null>; updatedAt: number }>;
  authState: JsonRecord | null;
}

interface PendingDataStart {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class DeviceConnectionBle implements DeviceConnectionBleLike {
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
    pendingReplies: new Map(),
    chunkAssemblies: new Map(),
    authState: null,
  };

  private eventSubscribers = new Set<(event: DeviceEvent) => void>();

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private reconnectDevice: BluetoothDevice | null = null;

  private forceRequestPicker = false;

  private pendingDataStart: PendingDataStart | null = null;

  private activeDataRequestId: string | null = null;

  private cachedSnapshot: JsonRecord | null = null;

  private cachedTrack: TrackPoint[] = [];

  private knownPartVersions: Record<string, number> = {};

  requestPickerOnNextConnect(): void {
    this.forceRequestPicker = true;
  }

  async connect(): Promise<void> {
    if (this.state.connected) {
      if (this.state.device?.gatt?.connected) {
        return;
      }
      this.handleDisconnectedState();
    }

    const usePicker = this.forceRequestPicker;
    const maybeKnown = usePicker ? null : await this.resolveReconnectDevice();
    this.forceRequestPicker = false;
    if (!usePicker && !maybeKnown) {
      throw new Error("No previously granted BLE device. Use Bluetooth search once.");
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
    }, maybeKnown);

    this.state.device = device;
    this.state.server = server;
    this.state.service = service;
    this.state.controlTx = controlTx;
    this.state.eventRx = eventRx;
    this.state.snapshot = snapshot;
    this.state.auth = auth;
    this.state.connected = true;
    this.state.chunkAssemblies.clear();
    this.reconnectDevice = device;
    setLastBleDevice(device.id, device.name?.trim() || "");

    await this.refreshAuthState();
    this.emitStatus();
  }

  async refreshReconnectAvailability(): Promise<{ available: boolean; deviceName: string }> {
    const device = await this.resolveReconnectDevice();
    return {
      available: Boolean(device),
      deviceName: device?.name?.trim() || getLastBleDeviceName(),
    };
  }

  async disconnect(): Promise<void> {
    await this.cancelActiveDataRequest("disconnect");
    if (disconnectBleDevice(this.state.device)) {
      setTimeout(() => {
        if (this.state.connected && !this.state.device?.gatt?.connected) {
          this.handleDisconnectedState();
        }
      }, 350);
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

  async sendConfigParts(command: ConfigPartsCommand): Promise<void> {
    const ifVersions = command.ifVersions ?? this.buildIfVersions(Object.keys(command.parts), "config");
    await this.sendTerminalCommand("update-config", buildConfigUpdatePayload({
      parts: command.parts,
      ifVersions,
    }));
  }

  async commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]> {
    const reply = await this.sendTerminalCommand("scan-wlan", {
      max_results: Math.max(1, Math.floor(maxResults)),
      include_hidden: includeHidden,
    });
    return parseWifiScanNetworks(reply.networks);
  }

  async commandWifiConnect(input: DeviceWifiConnectInput): Promise<DeviceCommandResult> {
    const reply = await this.sendTerminalCommand("connect-wlan", {
      ssid: input.ssid,
      passphrase: input.passphrase,
      security: input.security,
      country: input.country,
      hidden: input.hidden,
      if_versions: this.buildIfVersions(["wlan_config"], "config"),
    });
    return this.buildAcceptedResult(reply);
  }

  async commandAnchorRise(): Promise<DeviceCommandResult> {
    const reply = await this.sendTerminalCommand("raise-anchor", {
      if_versions: this.buildIfVersions(["anchor_position"], "config"),
    });
    return this.buildAcceptedResult(reply);
  }

  async commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult> {
    const reply = await this.sendTerminalCommand("move-anchor", {
      lat,
      lon,
      if_versions: this.buildIfVersions(["anchor_position"], "config"),
    });
    return this.buildAcceptedResult(reply);
  }

  async commandAlarmSilence(seconds: number): Promise<DeviceCommandResult> {
    const silenceForMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.floor(seconds * 1000)));
    const reply = await this.sendTerminalCommand("silence-alarm", {
      silence_for_ms: silenceForMs,
      if_versions: this.buildIfVersions(["alarm_state"], "state"),
    });
    return this.buildAcceptedResult(reply);
  }

  async requestStateSnapshot(): Promise<JsonRecord | null> {
    await this.ensureDataStream();
    return this.cachedSnapshot;
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    await this.ensureDataStream();
    if (limit <= 0) {
      return [];
    }
    return this.cachedTrack.slice(-Math.max(1, Math.floor(limit)));
  }

  async probe(): Promise<DeviceConnectionProbeResult> {
    return {
      ok: this.state.connected,
      resultText: this.state.connected ? "BLE device available" : "BLE disconnected",
      buildVersion: null,
    };
  }

  private buildAcceptedResult(data: JsonRecord): DeviceCommandResult {
    const rawStatus = typeof data.status === "string" ? data.status.trim() : "";
    if (rawStatus === "ok" || rawStatus === "accepted") {
      return { accepted: true, status: rawStatus, errorCode: null, errorDetail: null };
    }
    if (rawStatus === "failed" || rawStatus === "rejected") {
      return {
        accepted: false,
        status: rawStatus,
        errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
        errorDetail: typeof data.errorDetail === "string" ? data.errorDetail : null,
      };
    }
    return {
      accepted: true,
      status: "ok",
      errorCode: null,
      errorDetail: null,
    };
  }

  private buildIfVersions(partNames: string[], group: "state" | "config"): Record<string, number> {
    const out: Record<string, number> = {};
    for (const partName of partNames) {
      const key = `${group}:${partName}`;
      if (typeof this.knownPartVersions[key] === "number") {
        out[partName] = this.knownPartVersions[key];
      }
    }
    return out;
  }

  private async ensureConnected(): Promise<void> {
    if (this.state.connected && this.state.controlTx) {
      return;
    }
    await this.connect();
    if (!this.state.connected || !this.state.controlTx) {
      throw new Error("BLE device not connected");
    }
  }

  private async ensureDataStream(): Promise<void> {
    await this.ensureConnected();

    if (this.activeDataRequestId && this.cachedSnapshot) {
      return;
    }
    if (this.pendingDataStart) {
      await this.pendingDataStart.promise;
      return;
    }

    await this.cancelActiveDataRequest("replace");

    const reqId = makeRequestId();
    let resolveStart!: () => void;
    let rejectStart!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const pending: PendingDataStart = {
      promise,
      resolve: resolveStart,
      reject: rejectStart,
      timeout: setTimeout(() => {
        if (this.pendingDataStart === pending) {
          this.pendingDataStart = null;
        }
        if (this.activeDataRequestId === reqId) {
          this.activeDataRequestId = null;
        }
        rejectStart(new Error("get-data start timeout"));
      }, 4500),
    };

    this.pendingDataStart = pending;
    this.activeDataRequestId = reqId;
    await this.sendRawCommand({
      req_id: reqId,
      command: "get-data",
      data: {},
    });
    await pending.promise;
  }

  private async cancelActiveDataRequest(reason: string): Promise<void> {
    if (this.pendingDataStart) {
      clearTimeout(this.pendingDataStart.timeout);
      this.pendingDataStart.reject(new Error(`get-data canceled: ${reason}`));
      this.pendingDataStart = null;
    }
    if (!this.activeDataRequestId || !this.state.controlTx) {
      this.activeDataRequestId = null;
      return;
    }

    const originalReqId = this.activeDataRequestId;
    this.activeDataRequestId = null;
    try {
      await this.sendTerminalCommand("cancel", buildCancelPayload(originalReqId));
    } catch {
      // Best-effort cleanup only.
    }
  }

  private async sendTerminalCommand(command: string, data: JsonRecord): Promise<JsonRecord> {
    await this.ensureConnected();
    const reqId = makeRequestId();
    const responsePromise = new Promise<JsonRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.state.pendingReplies.delete(reqId);
        reject(new Error(`${command} timeout`));
      }, 5000);
      this.state.pendingReplies.set(reqId, { resolve, reject, timeout });
    });

    try {
      await this.sendRawCommand(buildCommandEnvelope({ reqId, command, data }));
      return await responsePromise;
    } catch (error) {
      const pending = this.state.pendingReplies.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.state.pendingReplies.delete(reqId);
      }
      throw error;
    }
  }

  private async sendRawCommand(envelope: { req_id: string; command: string; data: JsonRecord }): Promise<void> {
    await this.ensureConnected();
    if (!this.state.controlTx) {
      throw new Error("BLE control characteristic unavailable");
    }

    const raw = JSON.stringify(envelope);
    this.debugTraffic("outgoing", envelope.command, raw);
    await writeChunked(this.state.controlTx, makeMsgId(), raw, encoder);
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.state.connected,
      deviceName: this.state.device?.name?.trim() || getLastBleDeviceName(),
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
    if (!this.state.auth) {
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

  private handleProtocolReply(
    envelope: { req_id?: string; command?: string; state?: string; data?: JsonRecord },
    source: InboundSource,
  ): void {
    const reqId = typeof envelope.req_id === "string" ? envelope.req_id : "";
    const command = typeof envelope.command === "string" ? envelope.command : "";
    const state = envelope.state === "ONGOING" || envelope.state === "CLOSED_OK" || envelope.state === "CLOSED_FAILED"
      ? envelope.state
      : null;
    const data = isObject(envelope.data) ? envelope.data : {};
    if (!reqId || !command || !state) {
      return;
    }

    if (command === "get-data") {
      const snapshot = readProtocolSnapshotParts(data);
      if (snapshot) {
        applyPartVersions(this.knownPartVersions, snapshot);
        this.cachedSnapshot = mapProtocolPartsToLegacyState(snapshot);
        this.cachedTrack = snapshot.trackPoints.slice(-TRACK_MAX_POINTS);
        this.emitEvent({
          type: "state.snapshot",
          source,
          snapshot: this.cachedSnapshot,
        });
        if (this.cachedTrack.length > 0) {
          this.emitEvent({
            type: "track.snapshot",
            source,
            points: this.cachedTrack,
          });
        }
        if (this.pendingDataStart && this.activeDataRequestId === reqId) {
          const pending = this.pendingDataStart;
          this.pendingDataStart = null;
          clearTimeout(pending.timeout);
          pending.resolve();
        }
      }

      const update = readProtocolPartUpdate(data);
      if (update) {
        applyUpdateVersion(this.knownPartVersions, update);
        const patch = mapProtocolPartToLegacyPatch(update.group, update.name, update.value);
        if (Object.keys(patch).length > 0) {
          this.cachedSnapshot = deepMerge(this.cachedSnapshot ?? {}, patch);
          this.emitEvent({
            type: "state.patch",
            source,
            patch,
          });
        }
      }

      const appendedTrack = readProtocolTrackAppend(data);
      if (appendedTrack.length > 0) {
        this.cachedTrack = [...this.cachedTrack, ...appendedTrack].slice(-TRACK_MAX_POINTS);
        this.emitEvent({
          type: "track.snapshot",
          source,
          points: this.cachedTrack,
        });
      }

      if (state !== "ONGOING" && this.activeDataRequestId === reqId) {
        this.activeDataRequestId = null;
        if (this.pendingDataStart) {
          const pending = this.pendingDataStart;
          this.pendingDataStart = null;
          clearTimeout(pending.timeout);
          if (state === "CLOSED_OK") {
            pending.resolve();
          } else {
            const protocolError = extractProtocolError(data);
            pending.reject(new Error(`${protocolError.code}: ${protocolError.message}`));
          }
        }
      }
      return;
    }

    if (state === "ONGOING") {
      return;
    }

    const pending = this.state.pendingReplies.get(reqId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.state.pendingReplies.delete(reqId);
    if (state === "CLOSED_OK") {
      pending.resolve(data);
      return;
    }

    const protocolError = extractProtocolError(data);
    pending.reject(new Error(`${protocolError.code}: ${protocolError.message}`));
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

    let raw = "";
    if (bytes[0] === 0x7b) {
      raw = decoder.decode(bytes);
    } else {
      const frame = consumeChunkedBleFrame(
        this.state.chunkAssemblies,
        bytes,
        (chunk) => decoder.decode(chunk),
        BLE_CHUNK_TIMEOUT_MS,
      );
      if (frame.kind !== "complete" || !frame.raw) {
        return;
      }
      raw = frame.raw;
    }

    const parsed = safeParseJson(raw);
    if (!parsed || !isObject(parsed)) {
      return;
    }

    const command = typeof parsed.command === "string" ? parsed.command : "";
    const replyState = typeof parsed.state === "string" ? parsed.state : "";
    this.debugTraffic("incoming", command || "unknown", raw);
    if (!command || !replyState) {
      return;
    }

    this.handleProtocolReply(parsed as { req_id?: string; command?: string; state?: string; data?: JsonRecord }, "ble/eventRx");
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

    for (const pending of this.state.pendingReplies.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("BLE disconnected"));
    }
    this.state.pendingReplies.clear();

    if (this.pendingDataStart) {
      clearTimeout(this.pendingDataStart.timeout);
      this.pendingDataStart.reject(new Error("BLE disconnected"));
      this.pendingDataStart = null;
    }
    this.activeDataRequestId = null;
    this.emitStatus();
  }

  private async resolveReconnectDevice(): Promise<BluetoothDevice | null> {
    if (this.reconnectDevice) {
      return this.reconnectDevice;
    }
    const lastDeviceId = getLastBleDeviceId();
    if (!lastDeviceId) {
      return null;
    }
    const grantedDevices = await listGrantedBleDevices();
    const match = grantedDevices.find((device) => device.id === lastDeviceId) ?? null;
    this.reconnectDevice = match;
    return match;
  }

  private debugTraffic(
    direction: "incoming" | "outgoing",
    msgType: string,
    body: unknown,
  ): void {
    appendDebugMessage({
      direction,
      route: "ble",
      msgType,
      body,
    });
  }
}
