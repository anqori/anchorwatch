import { safeParseJson } from "../../services/data-utils";
import { DeviceConnectionBase } from "../device-connection-base";
import type { DeviceConnectionProbeResult } from "../device-connection";

export interface RelayCloudCredentials {
  base: string;
  boatId: string;
  cloudSecret: string;
}

interface WsTicketResponse {
  ws_ticket: string;
}

export class DeviceConnectionRelayCloud extends DeviceConnectionBase {
  readonly kind = "cloud-relay" as const;

  private ws: WebSocket | null = null;

  private wantConnected = false;

  private connectInFlight: Promise<void> | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly readCredentials: () => RelayCloudCredentials | null,
  ) {
    super();
  }

  async connect(): Promise<void> {
    this.wantConnected = true;
    if (this.isConnected() && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectInFlight) {
      await this.connectInFlight;
      return;
    }

    const credentials = this.readCredentials();
    if (!credentials) {
      this.setTransportStatus({ connected: false });
      throw new Error("Cloud relay credentials missing");
    }

    const attempt = this.openSocket(credentials)
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
    this.handleTransportDisconnected("Relay disconnected");
  }

  async probe(base?: string): Promise<DeviceConnectionProbeResult> {
    const credentials = this.readCredentials();
    const resolvedBase = (base ?? credentials?.base ?? "").trim();
    if (!resolvedBase) {
      return {
        ok: false,
        resultText: "Set relay base URL first.",
        buildVersion: null,
      };
    }
    if (!credentials) {
      return {
        ok: false,
        resultText: "Cloud relay credentials missing (relay URL + boat_id + cloud_secret)",
        buildVersion: null,
      };
    }

    const ticket = await this.fetchWsTicket({
      ...credentials,
      base: resolvedBase,
    });
    const socketUrl = buildRelayPipeSocketUrl(resolvedBase, ticket.ws_ticket);
    return await this.probeViaTemporarySocket(socketUrl);
  }

  protected async sendRaw(raw: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket not connected");
    }
    this.ws.send(raw);
  }

  private async openSocket(credentials: RelayCloudCredentials): Promise<void> {
    const ticket = await this.fetchWsTicket(credentials);
    const socketUrl = buildRelayPipeSocketUrl(credentials.base, ticket.ws_ticket);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl);

      const onOpen = (): void => {
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onCloseBeforeOpen);
        this.ws = socket;
        this.setTransportStatus({ connected: true });
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
        if (typeof event.data !== "string") {
          return;
        }
        this.handleIncomingRaw(event.data, "cloud/stream");
      });
      socket.addEventListener("close", () => {
        this.handleSocketClosed(socket);
      });
      socket.addEventListener("error", () => {
        this.handleSocketClosed(socket);
      });
    });
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.ws !== socket) {
      return;
    }
    this.ws = null;
    this.handleTransportDisconnected("Relay disconnected");
    this.scheduleReconnect();
  }

  private async fetchWsTicket(credentials: RelayCloudCredentials): Promise<WsTicketResponse> {
    const url = buildWsTicketUrl(credentials.base);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        boat_id: credentials.boatId,
        cloud_secret: credentials.cloudSecret,
        role: "app",
      }),
    });

    if (!response.ok) {
      throw new Error(`ws-ticket failed (${response.status})`);
    }

    const payload = safeParseJson(await response.text());
    if (!payload || typeof payload.ws_ticket !== "string" || !payload.ws_ticket.trim()) {
      throw new Error("ws-ticket response invalid");
    }

    return {
      ws_ticket: payload.ws_ticket,
    };
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

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.scheduleReconnect();
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
}

function buildWsTicketUrl(base: string): string {
  const url = new URL(base);
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/ws-ticket`;
  url.search = "";
  return url.toString();
}

function buildRelayPipeSocketUrl(base: string, ticket: string): string {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/pipe`;
  url.search = "";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
