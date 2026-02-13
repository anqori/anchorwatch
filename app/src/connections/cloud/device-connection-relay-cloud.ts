import type { Envelope, InboundSource, JsonRecord, PendingAck, TrackPoint, WifiScanNetwork } from "../../core/types";
import { isObject, parseTrackSnapshot, parseWifiScanNetworks, safeParseJson } from "../../services/data-utils";
import { buildConfigPatchPayload, buildProtocolEnvelope, type ConfigPatchCommand } from "../../services/protocol-messages";
import { readAlertRuntimeEntries } from "../../services/state-derive";
import { makeAckPromise, clearPendingAcks, resolvePendingAckFromPayload } from "../ble/ble-session";
import { makeMsgId } from "../ble/ble-transport";
import type {
  DeviceConnection,
  DeviceCommandResult,
  DeviceEvent,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
} from "../device-connection";

export interface RelayCloudCredentials {
  base: string;
  boatId: string;
  boatSecret: string;
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

const RELAY_SOURCE: InboundSource = "cloud/status.snapshot";

export class DeviceConnectionRelayCloud implements DeviceConnection {
  readonly kind = "cloud-relay" as const;

  private connected = false;

  private ws: WebSocket | null = null;

  private wantConnected = false;

  private connectInFlight: Promise<void> | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private seq = 1;

  private eventSubscribers = new Set<(event: DeviceEvent) => void>();

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private pendingAcks = new Map<string, PendingAck>();

  private pendingSnapshots: PendingSnapshotRequest[] = [];

  private pendingTracks: PendingTrackRequest[] = [];

  constructor(
    private readonly readCredentials: () => RelayCloudCredentials | null,
    private readonly getDeviceId: () => string,
    private readonly protocolVersion: string,
  ) {}

  async connect(): Promise<void> {
    this.wantConnected = true;

    if (this.connected) {
      return;
    }
    if (this.connectInFlight) {
      await this.connectInFlight;
      return;
    }

    const credentials = this.readCredentials();
    if (!credentials) {
      this.setConnected(false);
      return;
    }

    const attempt = this.openSocket(credentials)
      .then(() => {
        this.clearReconnectTimer();
        this.setConnected(true);
      })
      .catch((error) => {
        this.setConnected(false);
        this.scheduleReconnect();
        throw error;
      })
      .finally(() => {
        this.connectInFlight = null;
      });

    this.connectInFlight = attempt;
    await attempt;
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.clearReconnectTimer();

    const socket = this.ws;
    this.ws = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }

    this.failPending("Relay disconnected");
    this.setConnected(false);
  }

  isConnected(): boolean {
    return this.connected;
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
    await this.sendEnvelope("config.patch", buildConfigPatchPayload(command), true);
  }

  async commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]> {
    const requestId = `wifi-${makeMsgId()}`;
    const ack = await this.sendEnvelope("onboarding.wifi.scan", {
      requestId,
      maxResults,
      includeHidden,
    }, true);
    return parseWifiScanNetworks(ack?.networks);
  }

  async commandAnchorRise(): Promise<DeviceCommandResult> {
    const ack = await this.sendEnvelope("anchor.rise", {}, true);
    return this.parseCommandResult(ack);
  }

  async commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult> {
    const ack = await this.sendEnvelope("anchor.down", { lat, lon }, true);
    return this.parseCommandResult(ack);
  }

  async commandAlarmSilence(seconds: number): Promise<DeviceCommandResult> {
    const silenceForMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.floor(seconds * 1000)));
    const ack = await this.sendEnvelope("alarm.silence.request", { silenceForMs }, true);
    return this.parseCommandResult(ack);
  }

  async requestStateSnapshot(): Promise<JsonRecord | null> {
    await this.ensureConnected();

    const snapshotPromise = new Promise<JsonRecord | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSnapshots = this.pendingSnapshots.filter((entry) => entry !== pending);
        resolve(null);
      }, 3500);
      const pending: PendingSnapshotRequest = { resolve, reject, timeout };
      this.pendingSnapshots.push(pending);
    });

    await this.sendEnvelope("status.snapshot.request", {}, false);
    return snapshotPromise;
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    await this.ensureConnected();

    const trackPromise = new Promise<TrackPoint[] | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTracks = this.pendingTracks.filter((entry) => entry !== pending);
        resolve(null);
      }, 4500);
      const pending: PendingTrackRequest = { resolve, reject, timeout };
      this.pendingTracks.push(pending);
    });

    await this.sendEnvelope("track.snapshot.request", {
      limit: Math.max(1, Math.floor(limit)),
    }, false);
    return trackPromise;
  }

  async probe(base?: string): Promise<DeviceConnectionProbeResult> {
    const resolvedBase = (base ?? this.readCredentials()?.base ?? "").trim();
    if (!resolvedBase) {
      return {
        ok: false,
        resultText: "Set relay base URL first.",
        buildVersion: null,
      };
    }

    const currentCredentials = this.readCredentials();
    if (!currentCredentials) {
      return {
        ok: false,
        resultText: "Cloud relay credentials missing (relay URL + boatId + boatSecret)",
        buildVersion: null,
      };
    }

    const probeSocketUrl = buildRelayPipeSocketUrl(resolvedBase, {
      boatId: currentCredentials.boatId,
      boatSecret: currentCredentials.boatSecret,
      deviceId: this.getDeviceId(),
      role: "app",
    });

    const probeResult = await this.probeViaTemporarySocket(probeSocketUrl, currentCredentials.boatId);
    return probeResult;
  }

  private async openSocket(credentials: RelayCloudCredentials): Promise<void> {
    const socketUrl = buildRelayPipeSocketUrl(credentials.base, {
      boatId: credentials.boatId,
      boatSecret: credentials.boatSecret,
      deviceId: this.getDeviceId(),
      role: "app",
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl);

      const onOpen = (): void => {
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onCloseBeforeOpen);
        this.ws = socket;
        resolve();
      };

      const onError = (): void => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("close", onCloseBeforeOpen);
        reject(new Error("Relay WebSocket connection failed"));
      };

      const onCloseBeforeOpen = (): void => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        reject(new Error("Relay WebSocket closed before open"));
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onCloseBeforeOpen, { once: true });

      socket.addEventListener("message", (event) => {
        this.handleSocketMessage(event);
      });
      socket.addEventListener("close", () => {
        this.handleSocketClosed(socket);
      });
      socket.addEventListener("error", () => {
        this.handleSocketClosed(socket);
      });
    });
  }

  private async probeViaTemporarySocket(socketUrl: string, boatId: string): Promise<DeviceConnectionProbeResult> {
    const socket = new WebSocket(socketUrl);

    return await new Promise<DeviceConnectionProbeResult>((resolve, reject) => {
      let done = false;
      const msgId = makeMsgId();

      const finish = (result: DeviceConnectionProbeResult, isError = false): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        socket.close();
        if (isError) {
          reject(new Error(result.resultText));
          return;
        }
        resolve(result);
      };

      const timeout = setTimeout(() => {
        finish({ ok: false, resultText: "relay probe timeout", buildVersion: null }, true);
      }, 3500);

      socket.addEventListener("open", () => {
        const envelope = buildProtocolEnvelope({
          protocolVersion: this.protocolVersion,
          msgType: "relay.probe",
          msgId,
          boatId,
          deviceId: this.getDeviceId(),
          seq: 1,
          requiresAck: false,
          payload: {},
        });
        socket.send(JSON.stringify(envelope));
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        const parsed = safeParseJson(event.data);
        if (!parsed) {
          return;
        }
        const msgType = typeof parsed.msgType === "string" ? parsed.msgType : "";
        if (msgType !== "relay.probe.result") {
          return;
        }
        const payload = isObject(parsed.payload) ? parsed.payload : {};
        const inReplyToMsgId = typeof payload.inReplyToMsgId === "string" ? payload.inReplyToMsgId : "";
        if (inReplyToMsgId && inReplyToMsgId !== msgId) {
          return;
        }

        const ok = payload.ok === true;
        const resultText = typeof payload.resultText === "string"
          ? payload.resultText
          : ok
            ? "relay probe ok"
            : "relay probe failed";
        const buildVersion = typeof payload.buildVersion === "string" && payload.buildVersion.trim()
          ? payload.buildVersion.trim()
          : null;

        finish({ ok, resultText, buildVersion }, !ok);
      });

      socket.addEventListener("error", () => {
        finish({ ok: false, resultText: "relay probe socket error", buildVersion: null }, true);
      });

      socket.addEventListener("close", () => {
        if (!done) {
          finish({ ok: false, resultText: "relay probe socket closed", buildVersion: null }, true);
        }
      });
    });
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

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket not connected");
    }
  }

  private async sendEnvelope(msgType: string, payload: JsonRecord, requiresAck: boolean): Promise<JsonRecord | null> {
    await this.ensureConnected();

    const credentials = this.requireCredentials();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket not connected");
    }

    const envelope = buildProtocolEnvelope({
      protocolVersion: this.protocolVersion,
      msgType,
      msgId: makeMsgId(),
      boatId: credentials.boatId,
      deviceId: this.getDeviceId(),
      seq: this.seq++,
      requiresAck,
      payload,
    });

    const raw = JSON.stringify(envelope);
    const ackPromise = requiresAck && envelope.msgId
      ? makeAckPromise(this.pendingAcks, envelope.msgId)
      : null;

    try {
      ws.send(raw);
      if (!ackPromise) {
        return null;
      }
      return await ackPromise;
    } catch (error) {
      if (envelope.msgId) {
        this.pendingAcks.delete(envelope.msgId);
      }
      throw error;
    }
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.connected,
      deviceName: "",
      authState: null,
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

  private setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    this.emitStatus();
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantConnected) {
        return;
      }
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, 1500);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private failPending(reason: string): void {
    clearPendingAcks(this.pendingAcks, reason);

    for (const pending of this.pendingSnapshots) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingSnapshots = [];

    for (const pending of this.pendingTracks) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingTracks = [];
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.ws !== socket) {
      return;
    }

    this.ws = null;
    this.failPending("Relay disconnected");
    this.setConnected(false);
    this.scheduleReconnect();
  }

  private handleSocketMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }

    const envelope = safeParseJson(event.data) as Envelope | null;
    if (!envelope || !isObject(envelope)) {
      return;
    }

    if (envelope.msgType === "command.ack") {
      const payload = isObject(envelope.payload) ? envelope.payload : {};
      resolvePendingAckFromPayload(this.pendingAcks, payload);
      return;
    }

    const deviceEvent = this.toDeviceEvent(envelope);
    if (!deviceEvent) {
      return;
    }

    if (deviceEvent.type === "state.snapshot" && isObject(deviceEvent.snapshot)) {
      const pending = this.pendingSnapshots.shift();
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(deviceEvent.snapshot);
      }
    }

    if (deviceEvent.type === "track.snapshot") {
      const pending = this.pendingTracks.shift();
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(deviceEvent.points);
      }
    }

    this.emitEvent(deviceEvent);
  }

  private toDeviceEvent(envelope: Envelope): DeviceEvent | null {
    const boatId = typeof envelope.boatId === "string" && envelope.boatId ? envelope.boatId : undefined;
    const payload: JsonRecord = isObject(envelope.payload) ? envelope.payload : {};
    const msgType = typeof envelope.msgType === "string" && envelope.msgType ? envelope.msgType : "unknown";

    if (msgType === "relay.probe.result" || msgType === "relay.error") {
      return null;
    }

    if (msgType === "status.patch") {
      return {
        type: "state.patch",
        source: RELAY_SOURCE,
        boatId,
        patch: payload.statePatch,
      };
    }

    if (msgType === "status.snapshot") {
      return {
        type: "state.snapshot",
        source: RELAY_SOURCE,
        boatId,
        snapshot: payload.snapshot,
      };
    }

    if (msgType === "onboarding.boat_secret") {
      return {
        type: "onboarding.boatSecret",
        source: RELAY_SOURCE,
        boatId,
        onboardingBoatId: typeof payload.boatId === "string" ? payload.boatId : undefined,
        boatSecret: typeof payload.boatSecret === "string" ? payload.boatSecret : undefined,
      };
    }

    if (msgType === "track.snapshot") {
      return {
        type: "track.snapshot",
        source: RELAY_SOURCE,
        boatId,
        points: parseTrackSnapshot(payload),
      };
    }

    if (msgType === "alerts.state" || msgType === "alarm.state") {
      const alertsPayload = isObject(payload.alerts) ? payload.alerts : payload;
      return {
        type: "alerts.state",
        source: RELAY_SOURCE,
        boatId,
        alerts: readAlertRuntimeEntries({ alerts: alertsPayload }),
      };
    }

    return {
      type: "unknown",
      source: RELAY_SOURCE,
      boatId,
      msgType,
      payload,
    };
  }

  private requireCredentials(): RelayCloudCredentials {
    const credentials = this.readCredentials();
    if (!credentials) {
      throw new Error("Cloud relay credentials missing (relay URL + boatId + boatSecret)");
    }
    return credentials;
  }
}

function buildRelayPipeSocketUrl(
  base: string,
  input: { boatId: string; boatSecret: string; deviceId: string; role: "app" | "device" },
): string {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;

  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/pipe`;
  url.search = "";
  url.searchParams.set("boatId", input.boatId);
  url.searchParams.set("boatSecret", input.boatSecret);
  url.searchParams.set("deviceId", input.deviceId);
  url.searchParams.set("role", input.role);
  return url.toString();
}
