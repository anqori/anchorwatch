import { Capacitor } from "@capacitor/core";
import { BleClient, ConnectionPriority, type BleDevice } from "@capacitor-community/bluetooth-le";
import {
  BLE_AUTH_UUID,
  BLE_CHUNK_TIMEOUT_MS,
  BLE_CONTROL_TX_UUID,
  BLE_EVENT_RX_UUID,
  BLE_SERVICE_UUID,
  PROTOCOL_VERSION,
} from "../../core/constants";
import type { Envelope, InboundSource, JsonRecord, PendingAck, TrackPoint, WifiScanNetwork } from "../../core/types";
import {
  clearPendingAcks,
  consumeChunkedBleFrame,
  makeAckPromise,
  resolvePendingAckFromPayload,
} from "./ble-session";
import { buildChunkedFrames, makeMsgId } from "./ble-transport";
import {
  dataViewToBytes,
  isObject,
  parseTrackSnapshot,
  parseWifiScanNetworks,
  safeParseJson,
} from "../../services/data-utils";
import { buildConfigPatchPayload, buildProtocolEnvelope, type ConfigPatchCommand } from "../../services/protocol-messages";
import { readAlertRuntimeEntries } from "../../services/state-derive";
import {
  ensurePhoneId,
  getBoatId,
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
} from "../device-connection";
import type { DeviceConnectionBleLike } from "./device-connection-ble-like";

interface BleTransportStateNative {
  deviceId: string;
  deviceName: string;
  connected: boolean;
  seq: number;
  pendingAcks: Map<string, PendingAck>;
  chunkAssemblies: Map<string, { partCount: number; parts: Array<string | null>; updatedAt: number }>;
  authState: JsonRecord | null;
}

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

interface PendingWifiScanRequest {
  resolve: (networks: WifiScanNetwork[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const WIFI_SCAN_RESULT_TIMEOUT_MS = 20_000;

export class DeviceConnectionBleNative implements DeviceConnectionBleLike {
  readonly kind = "bluetooth" as const;

  private initialized = false;

  private initPromise: Promise<void> | null = null;

  private state: BleTransportStateNative = {
    deviceId: "",
    deviceName: "",
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

  private pendingWifiScans = new Map<string, PendingWifiScanRequest>();

  private reconnectDevice: BleDevice | null = null;

  private forceRequestPicker = false;

  requestPickerOnNextConnect(): void {
    this.forceRequestPicker = true;
  }

  async connect(): Promise<void> {
    if (this.state.connected) {
      return;
    }

    await this.ensureInitialized();
    const usePicker = this.forceRequestPicker;
    const maybeKnown = usePicker ? null : await this.resolveReconnectDevice();
    this.forceRequestPicker = false;

    if (!usePicker && !maybeKnown) {
      throw new Error("No previously paired BLE device. Use Bluetooth search once.");
    }

    const nextDevice = maybeKnown ?? await this.requestDeviceFromPicker();
    await this.connectToDevice(nextDevice);
  }

  async refreshReconnectAvailability(): Promise<{ available: boolean; deviceName: string }> {
    const fromMemory = this.reconnectDevice?.deviceId?.trim();
    const persistedId = getLastBleDeviceId();
    if (!fromMemory && !persistedId) {
      return { available: false, deviceName: "" };
    }

    const device = await this.resolveReconnectDevice();
    return {
      available: true,
      deviceName: device?.name?.trim() || getLastBleDeviceName(),
    };
  }

  async disconnect(): Promise<void> {
    const deviceId = this.state.deviceId.trim();
    if (!deviceId) {
      this.handleDisconnectedState();
      return;
    }

    try {
      await BleClient.stopNotifications(deviceId, BLE_SERVICE_UUID, BLE_EVENT_RX_UUID);
    } catch {
      // ignore and proceed with disconnect cleanup
    }

    try {
      await BleClient.disconnect(deviceId);
    } catch {
      // ignore and reset local transport state
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
    const scanResultPromise = this.makeWifiScanPromise(requestId);
    try {
      const ack = await this.sendBleCommand("onboarding.wifi.scan", {
        requestId,
        maxResults,
        includeHidden,
      }, true);
      if (ack && "networks" in ack) {
        this.handleWifiScanResult({ requestId, networks: ack.networks });
      }
    } catch (error) {
      this.rejectPendingWifiScanRequest(requestId, error);
      throw error;
    }
    return await scanResultPromise;
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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = BleClient.initialize();
    await this.initPromise;
    this.initialized = true;
    this.initPromise = null;
  }

  private async requestDeviceFromPicker(): Promise<BleDevice> {
    try {
      // Prefer service-based filtering first to avoid missing devices whose advertised name is absent/truncated.
      return await BleClient.requestDevice({
        services: [BLE_SERVICE_UUID],
        optionalServices: [BLE_SERVICE_UUID],
      });
    } catch {
      // Fallback to broad picker and validate required characteristics after connect.
      return await BleClient.requestDevice({
        optionalServices: [BLE_SERVICE_UUID],
      });
    }
  }

  private async connectToDevice(device: BleDevice): Promise<void> {
    const deviceId = device.deviceId.trim();
    if (!deviceId) {
      throw new Error("Selected BLE device has no identifier.");
    }

    try {
      await BleClient.connect(deviceId, this.onBleDisconnected);
      const services = await BleClient.getServices(deviceId);
      this.assertRequiredCharacteristics(services);
      await BleClient.startNotifications(deviceId, BLE_SERVICE_UUID, BLE_EVENT_RX_UUID, this.onBleNotification);

      this.state.deviceId = deviceId;
      this.state.deviceName = device.name?.trim() || "";
      this.state.connected = true;
      this.state.chunkAssemblies.clear();
      this.reconnectDevice = {
        deviceId,
        name: this.state.deviceName,
      };
      setLastBleDevice(deviceId, this.state.deviceName);
      this.emitStatus();

      if (Capacitor.getPlatform() === "android") {
        void BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {
          // Connection priority is optional.
        });
      }

      void this.refreshAuthState().then(() => {
        this.emitStatus();
      });
    } catch (error) {
      try {
        await BleClient.disconnect(deviceId);
      } catch {
        // ignore disconnect cleanup errors after failed connect
      }
      this.handleDisconnectedState();
      throw error;
    }
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.state.connected,
      deviceName: this.state.deviceName,
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
    const deviceId = this.state.deviceId.trim();
    if (!this.state.connected || !deviceId) {
      this.state.authState = null;
      return;
    }

    try {
      const value = await BleClient.read(deviceId, BLE_SERVICE_UUID, BLE_AUTH_UUID);
      const raw = decoder.decode(dataViewToBytes(value));
      const parsed = safeParseJson(raw);
      this.state.authState = isObject(parsed) ? parsed : null;
    } catch {
      this.state.authState = null;
    }
  }

  private async sendBleCommand(msgType: string, payload: JsonRecord, requiresAck = true): Promise<JsonRecord | null> {
    const deviceId = this.state.deviceId.trim();
    if (!this.state.connected || !deviceId) {
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
      const frames = buildChunkedFrames(envelope.msgId as string, raw, encoder);
      this.debugTraffic("outgoing", msgType, raw);
      for (const frame of frames) {
        await this.writeFrame(deviceId, frame);
      }
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

  private async writeFrame(deviceId: string, frame: Uint8Array): Promise<void> {
    const value = new DataView(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    try {
      await BleClient.writeWithoutResponse(deviceId, BLE_SERVICE_UUID, BLE_CONTROL_TX_UUID, value);
    } catch {
      await BleClient.write(deviceId, BLE_SERVICE_UUID, BLE_CONTROL_TX_UUID, value);
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

  private makeWifiScanPromise(requestId: string): Promise<WifiScanNetwork[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWifiScans.delete(requestId);
        reject(new Error("WLAN scan result timeout"));
      }, WIFI_SCAN_RESULT_TIMEOUT_MS);
      this.pendingWifiScans.set(requestId, { resolve, reject, timeout });
    });
  }

  private rejectPendingWifiScanRequest(requestId: string, error: unknown): void {
    const pending = this.pendingWifiScans.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingWifiScans.delete(requestId);
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private handleWifiScanResult(payload: JsonRecord): void {
    const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
    if (!requestId) {
      return;
    }

    const pending = this.pendingWifiScans.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingWifiScans.delete(requestId);

    const errorCode = typeof payload.errorCode === "string" ? payload.errorCode.trim() : "";
    const errorDetail = typeof payload.errorDetail === "string" ? payload.errorDetail.trim() : "";
    if (errorCode || errorDetail) {
      pending.reject(new Error(`${errorCode || "DEVICE_FAILED"}: ${errorDetail || "WLAN scan failed"}`));
      return;
    }

    pending.resolve(parseWifiScanNetworks(payload.networks));
  }

  private handleCommandAck(payload: JsonRecord): void {
    resolvePendingAckFromPayload(this.state.pendingAcks, payload);
  }

  private handleIncomingEnvelope(envelope: Envelope, source: InboundSource, rawEnvelope: string | null = null): void {
    const msgType = typeof envelope.msgType === "string" && envelope.msgType ? envelope.msgType : "unknown";
    this.debugTraffic("incoming", msgType, rawEnvelope ?? envelope);

    if (envelope.msgType === "command.ack") {
      const payload = isObject(envelope.payload) ? envelope.payload : {};
      this.handleCommandAck(payload);
      return;
    }
    if (envelope.msgType === "onboarding.wifi.scan_result") {
      const payload = isObject(envelope.payload) ? envelope.payload : {};
      this.handleWifiScanResult(payload);
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

  private onBleNotification = (value: DataView): void => {
    if (!this.state.connected) {
      const recoveredDeviceId = this.state.deviceId.trim() || this.reconnectDevice?.deviceId?.trim() || "";
      if (recoveredDeviceId) {
        this.state.connected = true;
        this.state.deviceId = recoveredDeviceId;
        if (!this.state.deviceName) {
          this.state.deviceName = this.reconnectDevice?.name?.trim() || "";
        }
        this.emitStatus();
      }
    }

    const bytes = dataViewToBytes(value);
    if (!bytes.length) {
      return;
    }

    if (bytes[0] === 0x7b) {
      const raw = decoder.decode(bytes);
      const parsed = safeParseJson(raw);
      if (!parsed || !isObject(parsed)) {
        return;
      }
      this.handleIncomingEnvelope(parsed as Envelope, "ble/eventRx", raw);
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
    this.handleIncomingEnvelope(parsed as Envelope, "ble/eventRx", frame.raw);
  };

  private onBleDisconnected = (deviceId: string): void => {
    void this.handleDisconnectSignal(deviceId);
  };

  private async handleDisconnectSignal(deviceId: string): Promise<void> {
    const currentDeviceId = this.state.deviceId.trim();
    if (!currentDeviceId) {
      this.handleDisconnectedState();
      return;
    }

    if (deviceId.trim() && !this.sameDeviceId(currentDeviceId, deviceId)) {
      return;
    }

    try {
      const connectedDevices = await BleClient.getConnectedDevices([BLE_SERVICE_UUID]);
      const stillConnected = connectedDevices.some((candidate) => this.sameDeviceId(candidate.deviceId, currentDeviceId));
      if (stillConnected) {
        const match = connectedDevices.find((candidate) => this.sameDeviceId(candidate.deviceId, currentDeviceId));
        if (match?.name?.trim() && !this.state.deviceName) {
          this.state.deviceName = match.name.trim();
        }
        this.state.connected = true;
        this.emitStatus();
        return;
      }
    } catch {
      // If verification fails, fall through to local disconnect handling.
    }

    this.handleDisconnectedState();
  }

  private handleDisconnectedState(): void {
    this.state.connected = false;
    this.state.deviceId = "";
    this.state.deviceName = "";
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
    for (const pending of this.pendingWifiScans.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("BLE disconnected"));
    }
    this.pendingWifiScans.clear();
    this.emitStatus();
  }

  private async resolveReconnectDevice(): Promise<BleDevice | null> {
    if (this.reconnectDevice) {
      return this.reconnectDevice;
    }

    const lastDeviceId = getLastBleDeviceId();
    if (!lastDeviceId) {
      return null;
    }

    try {
      const restored = await BleClient.getDevices([lastDeviceId]);
      const match = restored.find((device) => device.deviceId === lastDeviceId);
      if (match) {
        this.reconnectDevice = match;
        return match;
      }
    } catch {
      // Android may still connect directly by MAC address; fallback below.
    }

    const fallback: BleDevice = {
      deviceId: lastDeviceId,
      name: getLastBleDeviceName() || undefined,
    };
    this.reconnectDevice = fallback;
    return fallback;
  }

  private assertRequiredCharacteristics(
    services: Array<{ uuid: string; characteristics: Array<{ uuid: string }> }>,
  ): void {
    const service = services.find((candidate) => this.sameUuid(candidate.uuid, BLE_SERVICE_UUID));
    if (!service) {
      throw new Error("Selected BLE device is missing required AnchorMaster service.");
    }

    const required = [BLE_CONTROL_TX_UUID, BLE_EVENT_RX_UUID, BLE_AUTH_UUID];
    for (const requiredUuid of required) {
      const found = service.characteristics.some((candidate) => this.sameUuid(candidate.uuid, requiredUuid));
      if (!found) {
        throw new Error(`Selected BLE device is missing required characteristic ${requiredUuid}.`);
      }
    }
  }

  private sameUuid(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private sameDeviceId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
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
