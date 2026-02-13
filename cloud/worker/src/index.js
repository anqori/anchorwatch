const PROTOCOL_VERSION = "am.v1";
const BUILD_VERSION_DEFAULT = "run-unknown";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env.ALLOWED_ORIGIN || "*");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/v1/pipe") {
      if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
        return json(
          {
            ok: false,
            error: { code: "UPGRADE_REQUIRED", detail: "WebSocket upgrade required" },
          },
          426,
          cors,
        );
      }

      const boatId = String(url.searchParams.get("boatId") || "").trim();
      if (!boatId) {
        return json(
          {
            ok: false,
            error: { code: "INVALID_PAYLOAD", detail: "boatId query param required" },
          },
          400,
          cors,
        );
      }

      const authError = authorizeSocket(request, url, env, cors);
      if (authError) {
        return authError;
      }

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      if (!env.BOAT_PIPE || typeof env.BOAT_PIPE.idFromName !== "function") {
        return json(
          {
            ok: false,
            error: { code: "SERVER_ERROR", detail: "BOAT_PIPE durable object binding missing" },
          },
          500,
          cors,
        );
      }

      const id = env.BOAT_PIPE.idFromName(boatId);
      const stub = env.BOAT_PIPE.get(id);
      return stub.fetch(request);
    }

    return json({ ok: false, error: { code: "NOT_FOUND" } }, 404, cors);
  },
};

export class BoatPipeDurableObject {
  constructor(_state, env) {
    this.env = env;
    this.clients = new Map();
    this.seq = 1;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/pipe") {
      return new Response("Not found", { status: 404 });
    }

    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return json(
        {
          ok: false,
          error: { code: "UPGRADE_REQUIRED", detail: "WebSocket upgrade required" },
        },
        426,
      );
    }

    const boatId = String(url.searchParams.get("boatId") || "").trim();
    if (!boatId) {
      return json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", detail: "boatId query param required" },
        },
        400,
      );
    }

    const deviceId = String(url.searchParams.get("deviceId") || "unknown").trim() || "unknown";
    const role = normalizeRole(url.searchParams.get("role"));

    const webSocketPair = new WebSocketPair();
    const [clientSocket, relaySocket] = Object.values(webSocketPair);

    relaySocket.accept();

    const meta = {
      boatId,
      deviceId,
      role,
      connectedAt: Date.now(),
    };

    this.clients.set(relaySocket, meta);

    relaySocket.addEventListener("message", (event) => {
      this.handleMessage(relaySocket, event);
    });
    relaySocket.addEventListener("close", () => {
      this.dropClient(relaySocket);
    });
    relaySocket.addEventListener("error", () => {
      this.dropClient(relaySocket);
    });

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  handleMessage(sender, event) {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) {
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isObject(envelope)) {
      return;
    }

    const msgType = typeof envelope.msgType === "string" ? envelope.msgType : "";
    if (!msgType) {
      return;
    }

    if (msgType === "relay.probe") {
      this.replyRelayProbe(sender, envelope);
      return;
    }

    if (msgType.startsWith("relay.")) {
      this.replyRelayError(sender, envelope, "UNSUPPORTED_MSG_TYPE", `unsupported relay control msgType: ${msgType}`);
      return;
    }

    this.forwardToPeers(sender, raw);
  }

  replyRelayProbe(socket, requestEnvelope) {
    const senderMeta = this.clients.get(socket);
    if (!senderMeta) {
      return;
    }

    const payload = {
      ok: true,
      resultText: `Relay active (${this.clients.size} sockets)` ,
      buildVersion: String(this.env.BUILD_VERSION || BUILD_VERSION_DEFAULT),
      connectedSockets: this.clients.size,
      connectedApps: this.countRole("app"),
      connectedDevices: this.countRole("device"),
      inReplyToMsgId: typeof requestEnvelope.msgId === "string" ? requestEnvelope.msgId : null,
    };

    this.sendEnvelope(socket, {
      ver: PROTOCOL_VERSION,
      msgType: "relay.probe.result",
      msgId: buildMsgId(),
      boatId: senderMeta.boatId,
      deviceId: "relay",
      seq: this.seq++,
      ts: Date.now(),
      requiresAck: false,
      payload,
    });
  }

  replyRelayError(socket, requestEnvelope, code, detail) {
    const senderMeta = this.clients.get(socket);
    if (!senderMeta) {
      return;
    }

    this.sendEnvelope(socket, {
      ver: PROTOCOL_VERSION,
      msgType: "relay.error",
      msgId: buildMsgId(),
      boatId: senderMeta.boatId,
      deviceId: "relay",
      seq: this.seq++,
      ts: Date.now(),
      requiresAck: false,
      payload: {
        ok: false,
        code,
        detail,
        inReplyToMsgId: typeof requestEnvelope.msgId === "string" ? requestEnvelope.msgId : null,
      },
    });
  }

  forwardToPeers(sender, rawEnvelope) {
    for (const [socket] of this.clients.entries()) {
      if (socket === sender || socket.readyState !== 1) {
        continue;
      }
      try {
        socket.send(rawEnvelope);
      } catch {
        this.dropClient(socket);
      }
    }
  }

  dropClient(socket) {
    if (!this.clients.has(socket)) {
      return;
    }
    this.clients.delete(socket);
    try {
      if (socket.readyState === 1) {
        socket.close(1000, "closed");
      }
    } catch {
      // no-op
    }
  }

  countRole(role) {
    let count = 0;
    for (const meta of this.clients.values()) {
      if (meta.role === role) {
        count += 1;
      }
    }
    return count;
  }

  sendEnvelope(socket, envelope) {
    if (socket.readyState !== 1) {
      return;
    }
    try {
      socket.send(JSON.stringify(envelope));
    } catch {
      this.dropClient(socket);
    }
  }
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function authorizeSocket(request, url, env, cors) {
  const expectedSecret = String(env.BOAT_SECRET || "").trim();
  if (!expectedSecret) {
    return null;
  }

  const querySecret = String(url.searchParams.get("boatSecret") || "").trim();
  const authHeader = request.headers.get("authorization") || "";
  const authMatch = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const providedSecret = querySecret || authMatch;

  if (providedSecret !== expectedSecret) {
    return json(
      {
        ok: false,
        error: { code: "AUTH_FAILED", detail: "invalid or missing boat secret" },
      },
      401,
      cors,
    );
  }
  return null;
}

function enforceBoatScope(boatId, env, cors) {
  const expectedBoatId = String(env.BOAT_ID || "").trim();
  if (!expectedBoatId || !boatId) {
    return null;
  }
  if (boatId !== expectedBoatId) {
    return json(
      {
        ok: false,
        error: { code: "AUTH_FAILED", detail: "boatId does not match configured scope" },
      },
      403,
      cors,
    );
  }
  return null;
}

function normalizeRole(rawRole) {
  return rawRole === "device" ? "device" : "app";
}

function buildMsgId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
