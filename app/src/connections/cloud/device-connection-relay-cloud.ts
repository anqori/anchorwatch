import type { InboundSource, JsonRecord, PendingAck, TrackPoint, WifiScanNetwork } from "../../core/types";
import { TRACK_MAX_POINTS } from "../../core/constants";
import { deepMerge, isObject, parseWifiScanNetworks, safeParseJson } from "../../services/data-utils";
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
  normalizeReplyState,
  type ConfigPartsCommand,
} from "../../services/protocol-messages";
import { appendDebugMessage } from "../../state/app-state.svelte";
import type {
  DeviceConnection,
  DeviceCommandResult,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
  DeviceEvent,
  DeviceWifiConnectInput,
} from "../device-connection";

export interface RelayCloudCredentials {
  base: string;
  boatId: string;
  boatSecret: string;
}

const RELAY_SOURCE: InboundSource = "cloud/stream";

interface PendingDataStart {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DeviceConnectionRelayCloud implements DeviceConnection {
  readonly kind = "cloud-relay" as const;

  private connected = false;

  private ws: WebSocket | null = null;

  private wantConnected = false;

  private connectInFlight: Promise<void> | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private eventSubscribers = new Set<(event: DeviceEvent) => void>();

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private pendingReplies = new Map<string, PendingAck>();

  private pendingDataStart: PendingDataStart | null = null;

  private activeDataRequestId: string | null = null;

  private cachedSnapshot: JsonRecord | null = null;

  private cachedTrack: TrackPoint[] = [];

  private knownPartVersions: Record<string, number> = {};

  constructor(
    private readonly readCredentials: () => RelayCloudCredentials | null,
    private readonly getDeviceId: () => string,
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
    await this.cancelActiveDataRequest("disconnect");

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

    return await this.probeViaTemporarySocket(probeSocketUrl);
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

  private async probeViaTemporarySocket(socketUrl: string): Promise<DeviceConnectionProbeResult> {
    const socket = new WebSocket(socketUrl);

    return await new Promise<DeviceConnectionProbeResult>((resolve, reject) => {
      let done = false;

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
        finish({ ok: false, resultText: "relay socket timeout", buildVersion: null }, true);
      }, 3500);

      socket.addEventListener("open", () => {
        finish({ ok: true, resultText: "relay socket accepted", buildVersion: null });
      });

      socket.addEventListener("error", () => {
        finish({ ok: false, resultText: "relay socket error", buildVersion: null }, true);
      });

      socket.addEventListener("close", () => {
        if (!done) {
          finish({ ok: false, resultText: "relay socket closed", buildVersion: null }, true);
        }
      });
    });
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
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket not connected");
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
    if (!this.activeDataRequestId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.activeDataRequestId = null;
      return;
    }

    const originalReqId = this.activeDataRequestId;
    this.activeDataRequestId = null;
    this.pendingDataStart = null;
    try {
      await this.sendTerminalCommand("cancel", buildCancelPayload(originalReqId));
      this.debugTraffic("outgoing", "cancel", { reason, original_req_id: originalReqId });
    } catch {
      // Best-effort cleanup only.
    }
  }

  private async sendTerminalCommand(command: string, data: JsonRecord): Promise<JsonRecord> {
    await this.ensureConnected();
    const reqId = makeRequestId();
    const responsePromise = new Promise<JsonRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingReplies.delete(reqId);
        reject(new Error(`${command} timeout`));
      }, 5000);
      this.pendingReplies.set(reqId, { resolve, reject, timeout });
    });

    try {
      await this.sendRawCommand(buildCommandEnvelope({ reqId, command, data }));
      return await responsePromise;
    } catch (error) {
      const pending = this.pendingReplies.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingReplies.delete(reqId);
      }
      throw error;
    }
  }

  private async sendRawCommand(envelope: { req_id: string; command: string; data: JsonRecord }): Promise<void> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket not connected");
    }

    const raw = JSON.stringify(envelope);
    this.debugTraffic("outgoing", envelope.command, raw);
    ws.send(raw);
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

    const envelope = safeParseJson(event.data);
    if (!envelope) {
      return;
    }

    const reqId = typeof envelope.req_id === "string" ? envelope.req_id : "";
    const command = typeof envelope.command === "string" ? envelope.command : "";
    const state = normalizeReplyState(envelope.state);
    const data = isObject(envelope.data) ? envelope.data : {};
    if (!reqId || !command || !state) {
      this.debugTraffic("incoming", "unknown", event.data);
      return;
    }

    this.debugTraffic("incoming", command, event.data);

    if (command === "get-data") {
      this.handleGetDataReply(reqId, state, data);
      return;
    }

    if (state === "ONGOING") {
      return;
    }

    const pending = this.pendingReplies.get(reqId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingReplies.delete(reqId);

    if (state === "CLOSED_OK") {
      pending.resolve(data);
      return;
    }

    const protocolError = extractProtocolError(data);
    pending.reject(new Error(`${protocolError.code}: ${protocolError.message}`));
  }

  private handleGetDataReply(reqId: string, state: "ONGOING" | "CLOSED_OK" | "CLOSED_FAILED", data: JsonRecord): void {
    const snapshot = readProtocolSnapshotParts(data);
    if (snapshot) {
      applyPartVersions(this.knownPartVersions, snapshot);
      this.cachedSnapshot = mapProtocolPartsToLegacyState(snapshot);
      this.cachedTrack = snapshot.trackPoints.slice(-TRACK_MAX_POINTS);
      this.emitEvent({
        type: "state.snapshot",
        source: RELAY_SOURCE,
        snapshot: this.cachedSnapshot,
      });
      if (this.cachedTrack.length > 0) {
        this.emitEvent({
          type: "track.snapshot",
          source: RELAY_SOURCE,
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
          source: RELAY_SOURCE,
          patch,
        });
      }
    }

    const appendedTrack = readProtocolTrackAppend(data);
    if (appendedTrack.length > 0) {
      this.cachedTrack = [...this.cachedTrack, ...appendedTrack].slice(-TRACK_MAX_POINTS);
      this.emitEvent({
        type: "track.snapshot",
        source: RELAY_SOURCE,
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
      void this.connect().catch(() => {
        // Retry loop is handled by connect -> scheduleReconnect.
      });
    }, 2500);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private failPending(reason: string): void {
    for (const pending of this.pendingReplies.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingReplies.clear();

    if (this.pendingDataStart) {
      clearTimeout(this.pendingDataStart.timeout);
      this.pendingDataStart.reject(new Error(reason));
      this.pendingDataStart = null;
    }

    this.activeDataRequestId = null;
  }

  private debugTraffic(
    direction: "incoming" | "outgoing",
    msgType: string,
    body: unknown,
  ): void {
    appendDebugMessage({
      direction,
      route: "relay",
      msgType,
      body,
    });
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
