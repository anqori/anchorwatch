const API_WS_TICKET_PATH = "/v1/ws-ticket";
const API_UPDATE_BOAT_SECRET_PATH = "/v1/update-boat-secret";
const API_PIPE_PATH = "/v1/pipe";
const INTERNAL_PIPE_PATH = "/internal/pipe";
const INTERNAL_ISSUE_TICKET_PATH = "/internal/ws-ticket";
const INTERNAL_REDEEM_TICKET_PATH = "/internal/redeem-ticket";
const INTERNAL_UPDATE_SECRET_PATH = "/internal/update-boat-secret";
const INTERNAL_SECRET_ROTATED_PATH = "/internal/secret-rotated";
const REGISTRY_OBJECT_NAME = "boat-registry";
const DEFAULT_WS_TICKET_TTL_MS = 60_000;
const MAX_WS_TICKET_TTL_MS = 5 * 60_000;
const BOAT_KEY_PREFIX = "boat:";
const TICKET_KEY_PREFIX = "ticket:";
const ROLE_APP = "app";
const ROLE_SERVER = "server";
const BOAT_STATE_SETUP_REQUIRED = "SETUP_REQUIRED";
const BOAT_STATE_LOCAL_READY = "LOCAL_READY";
const BOAT_STATE_CLOUD_READY = "CLOUD_READY";
const TRANSPORT_KIND_OPEN = "OPEN";
const TRANSPORT_KIND_PAYLOAD = "PAYLOAD";
const TRANSPORT_KIND_CLOSE = "CLOSE";
const NORMAL_CLOSE_CODE = 1000;
const POLICY_CLOSE_CODE = 1008;
const INTERNAL_ERROR_CLOSE_CODE = 1011;
const UNAVAILABLE_CLOSE_CODE = 1013;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env.ALLOWED_ORIGIN || "*");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === API_WS_TICKET_PATH && request.method === "POST") {
      return withCors(await issueWsTicket(request, env), cors);
    }

    if (url.pathname === API_UPDATE_BOAT_SECRET_PATH && request.method === "POST") {
      return withCors(await updateBoatSecret(request, env), cors);
    }

    if (url.pathname === API_PIPE_PATH) {
      return handlePipe(request, env, cors);
    }

    return jsonError("NOT_FOUND", "Route not found", 404, cors);
  },
};

export class BoatRegistryDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.preconfiguredBoats = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === INTERNAL_ISSUE_TICKET_PATH) {
      return this.handleIssueTicket(request);
    }

    if (request.method === "POST" && url.pathname === INTERNAL_REDEEM_TICKET_PATH) {
      return this.handleRedeemTicket(request);
    }

    if (request.method === "POST" && url.pathname === INTERNAL_UPDATE_SECRET_PATH) {
      return this.handleUpdateBoatSecret(request);
    }

    return jsonError("NOT_FOUND", "Registry route not found", 404);
  }

  async handleIssueTicket(request) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const boatId = requireNonEmptyString(body.value.boat_id);
    const cloudSecret = requireNonEmptyString(body.value.cloud_secret);
    const role = normalizeRole(body.value.role);

    if (!boatId) {
      return jsonError("INVALID_REQUEST", "boat_id is required", 400);
    }
    if (!cloudSecret) {
      return jsonError("INVALID_REQUEST", "cloud_secret is required", 400);
    }
    if (!role) {
      return jsonError("INVALID_REQUEST", "role must be app or server", 400);
    }

    const boat = await this.getBoatRecord(boatId, true);
    if (!boat) {
      return jsonError("AUTH_FAILED", "unknown boat_id", 401);
    }
    if (!boat.enabled) {
      return jsonError("AUTH_FAILED", "boat is disabled", 403);
    }
    if (boat.state !== BOAT_STATE_CLOUD_READY || !boat.secret_hash) {
      return jsonError("AUTH_FAILED", "boat is not cloud-ready", 403);
    }
    if (!(await secretMatches(cloudSecret, boat.secret_hash))) {
      return jsonError("AUTH_FAILED", "invalid cloud_secret", 401);
    }

    await this.pruneExpiredTicketIds();

    const ticket = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + getWsTicketTtlMs(this.env);
    await this.state.storage.put(ticketStorageKey(ticket), {
      boat_id: boatId,
      role,
      expires_at: expiresAt,
      created_at: now,
    });

    return jsonResponse(
      {
        boat_id: boatId,
        role,
        ws_ticket: ticket,
        expires_at: expiresAt,
      },
      200,
    );
  }

  async handleRedeemTicket(request) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const ticket = requireNonEmptyString(body.value.ws_ticket);
    if (!ticket) {
      return jsonError("INVALID_REQUEST", "ws_ticket is required", 400);
    }

    const key = ticketStorageKey(ticket);
    const ticketRecord = await this.state.storage.get(key);
    if (!ticketRecord) {
      return jsonError("AUTH_FAILED", "invalid or used ws_ticket", 401);
    }

    await this.state.storage.delete(key);

    if (Date.now() > Number(ticketRecord.expires_at || 0)) {
      return jsonError("AUTH_FAILED", "expired ws_ticket", 401);
    }

    const boat = await this.getBoatRecord(ticketRecord.boat_id, true);
    if (!boat || !boat.enabled || boat.state !== BOAT_STATE_CLOUD_READY || !boat.secret_hash) {
      return jsonError("AUTH_FAILED", "boat unavailable", 401);
    }

    return jsonResponse(
      {
        boat_id: ticketRecord.boat_id,
        role: ticketRecord.role,
      },
      200,
    );
  }

  async handleUpdateBoatSecret(request) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const boatId = requireNonEmptyString(body.value.boat_id);
    const oldSecret = requireOptionalString(body.value.old_secret);
    const newSecret = requireNonEmptyString(body.value.new_secret);

    if (!boatId) {
      return jsonError("INVALID_REQUEST", "boat_id is required", 400);
    }
    if (!newSecret) {
      return jsonError("INVALID_REQUEST", "new_secret is required", 400);
    }

    const boat = await this.getBoatRecord(boatId, true);
    if (!boat) {
      return jsonError("AUTH_FAILED", "unknown boat_id", 401);
    }
    if (!boat.enabled) {
      return jsonError("AUTH_FAILED", "boat is disabled", 403);
    }
    if (boat.state === BOAT_STATE_CLOUD_READY) {
      if (!oldSecret) {
        return jsonError("INVALID_REQUEST", "old_secret is required", 400);
      }
      if (!boat.secret_hash) {
        return jsonError("AUTH_FAILED", "boat is not cloud-ready", 403);
      }
      if (!(await secretMatches(oldSecret, boat.secret_hash))) {
        return jsonError("AUTH_FAILED", "invalid old_secret", 401);
      }
    } else {
      if (boat.secret_hash) {
        return jsonError("INVALID_STATE", "cloud secret already configured", 409);
      }
    }

    const updatedBoat = {
      ...boat,
      state: BOAT_STATE_CLOUD_READY,
      secret_hash: await hashSecret(newSecret),
      updated_at: Date.now(),
    };
    await this.state.storage.put(boatStorageKey(boatId), updatedBoat);

    return jsonResponse(
      {
        boat_id: boatId,
        updated: true,
      },
      200,
    );
  }

  async getBoatRecord(boatId, seedFromEnv) {
    if (seedFromEnv) {
      await this.seedBoatFromEnvIfMissing(boatId);
    }
    return this.state.storage.get(boatStorageKey(boatId));
  }

  async seedBoatFromEnvIfMissing(boatId) {
    const existing = await this.state.storage.get(boatStorageKey(boatId));
    if (existing) {
      return existing;
    }

    const seedRecord = this.getPreconfiguredBoatMap().get(boatId);
    if (!seedRecord) {
      return null;
    }

    const storedRecord = {
      boat_id: seedRecord.boat_id,
      state: seedRecord.state,
      secret_hash: seedRecord.cloud_secret ? await hashSecret(seedRecord.cloud_secret) : null,
      enabled: seedRecord.enabled !== false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    await this.state.storage.put(boatStorageKey(boatId), storedRecord);
    return storedRecord;
  }

  getPreconfiguredBoatMap() {
    if (this.preconfiguredBoats) {
      return this.preconfiguredBoats;
    }

    this.preconfiguredBoats = parsePreconfiguredBoatMap(this.env.PRECONFIGURED_BOATS_JSON);
    return this.preconfiguredBoats;
  }

  async pruneExpiredTicketIds() {
    const tickets = await this.state.storage.list({ prefix: TICKET_KEY_PREFIX });
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, value] of tickets.entries()) {
      if (now > Number(value.expires_at || 0)) {
        expiredKeys.push(key);
      }
    }

    if (expiredKeys.length > 0) {
      await this.state.storage.delete(expiredKeys);
    }
  }
}

export class BoatPipeDurableObject {
  constructor(_state, _env) {
    this.serverSession = null;
    this.appSessions = new Map();
    this.nextCloudConnId = 1;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === INTERNAL_SECRET_ROTATED_PATH) {
      this.closeEntireBoat("secret_rotated");
      return jsonResponse({ closed: true }, 200);
    }

    if (url.pathname !== INTERNAL_PIPE_PATH) {
      return jsonError("NOT_FOUND", "Boat pipe route not found", 404);
    }

    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return jsonError("UPGRADE_REQUIRED", "WebSocket upgrade required", 426);
    }

    const boatId = requireNonEmptyString(request.headers.get("x-relay-boat-id"));
    const role = normalizeRole(request.headers.get("x-relay-role"));
    const ticketId = requireNonEmptyString(request.headers.get("x-relay-ticket-id"));

    if (!boatId || !role || !ticketId) {
      return jsonError("INVALID_REQUEST", "resolved boat_id, role, and ticket are required", 400);
    }

    if (role === ROLE_SERVER) {
      return this.acceptServerSocket(boatId, ticketId);
    }

    if (role === ROLE_APP) {
      return this.acceptAppSocket(boatId, ticketId);
    }

    return jsonError("INVALID_REQUEST", "Unsupported role", 400);
  }

  acceptServerSocket(boatId, ticketId) {
    const webSocketPair = new WebSocketPair();
    const [clientSocket, relaySocket] = Object.values(webSocketPair);
    relaySocket.accept();

    const previousServer = this.serverSession;
    const serverSession = {
      socket: relaySocket,
      boat_id: boatId,
      ticket_id: ticketId,
      connected_at: Date.now(),
    };

    this.serverSession = serverSession;
    this.attachServerListeners(serverSession);

    if (previousServer && previousServer.socket !== relaySocket) {
      this.closeAllAppSessions("server_replaced");
      closeSocket(previousServer.socket, INTERNAL_ERROR_CLOSE_CODE, "server_replaced");
    }

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  acceptAppSocket(boatId, ticketId) {
    if (!this.hasActiveServer()) {
      return jsonError("SERVER_UNAVAILABLE", "No server socket is active for this boat", 503);
    }

    const webSocketPair = new WebSocketPair();
    const [clientSocket, relaySocket] = Object.values(webSocketPair);
    relaySocket.accept();

    const cloudConnId = this.allocateCloudConnId();
    const appSession = {
      cloud_conn_id: cloudConnId,
      socket: relaySocket,
      boat_id: boatId,
      ticket_id: ticketId,
      connected_at: Date.now(),
    };

    this.appSessions.set(cloudConnId, appSession);
    this.attachAppListeners(appSession);

    if (!this.sendToServer({ kind: TRANSPORT_KIND_OPEN, cloud_conn_id: cloudConnId })) {
      this.appSessions.delete(cloudConnId);
      closeSocket(relaySocket, UNAVAILABLE_CLOSE_CODE, "server_unavailable");
      return jsonError("SERVER_UNAVAILABLE", "Server socket became unavailable", 503);
    }

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  attachServerListeners(serverSession) {
    serverSession.socket.addEventListener("message", (event) => {
      this.handleServerMessage(serverSession.socket, event);
    });
    serverSession.socket.addEventListener("close", () => {
      this.handleServerDisconnect(serverSession.socket, "server_disconnected");
    });
    serverSession.socket.addEventListener("error", () => {
      this.handleServerDisconnect(serverSession.socket, "server_error");
    });
  }

  attachAppListeners(appSession) {
    appSession.socket.addEventListener("message", (event) => {
      this.handleAppMessage(appSession.cloud_conn_id, event);
    });
    appSession.socket.addEventListener("close", () => {
      this.closeAppSession(appSession.cloud_conn_id, {
        close_code: NORMAL_CLOSE_CODE,
        close_reason: "app_disconnected",
        notify_server: true,
      });
    });
    appSession.socket.addEventListener("error", () => {
      this.closeAppSession(appSession.cloud_conn_id, {
        close_code: INTERNAL_ERROR_CLOSE_CODE,
        close_reason: "app_error",
        notify_server: true,
      });
    });
  }

  handleServerMessage(serverSocket, event) {
    if (!this.serverSession || this.serverSession.socket !== serverSocket) {
      return;
    }

    const raw = typeof event.data === "string" ? event.data : "";
    const envelope = safeParseJsonObject(raw);
    if (!envelope) {
      this.failClosedServer("invalid_envelope");
      return;
    }

    if (envelope.kind === TRANSPORT_KIND_PAYLOAD) {
      const cloudConnId = requireNonEmptyString(envelope.cloud_conn_id);
      if (!cloudConnId || !isPlainObject(envelope.payload)) {
        this.failClosedServer("invalid_envelope");
        return;
      }

      const appSession = this.appSessions.get(cloudConnId);
      if (!appSession) {
        this.failClosedServer("unknown_cloud_conn_id");
        return;
      }

      try {
        appSession.socket.send(JSON.stringify(envelope.payload));
      } catch {
        this.closeAppSession(cloudConnId, {
          close_code: INTERNAL_ERROR_CLOSE_CODE,
          close_reason: "app_send_failed",
          notify_server: true,
        });
      }
      return;
    }

    if (envelope.kind === TRANSPORT_KIND_CLOSE) {
      const cloudConnId = requireNonEmptyString(envelope.cloud_conn_id);
      if (!cloudConnId || !this.appSessions.has(cloudConnId)) {
        this.failClosedServer("unknown_cloud_conn_id");
        return;
      }

      this.closeAppSession(cloudConnId, {
        close_code: NORMAL_CLOSE_CODE,
        close_reason: sanitizeCloseReason(envelope.reason) || "closed_by_server",
        notify_server: false,
      });
      return;
    }

    this.failClosedServer("invalid_envelope");
  }

  handleAppMessage(cloudConnId, event) {
    const appSession = this.appSessions.get(cloudConnId);
    if (!appSession) {
      return;
    }

    const raw = typeof event.data === "string" ? event.data : "";
    const payload = safeParseJsonObject(raw);
    if (!payload) {
      this.closeAppSession(cloudConnId, {
        close_code: POLICY_CLOSE_CODE,
        close_reason: "invalid_payload",
        notify_server: true,
      });
      return;
    }

    const forwarded = this.sendToServer({
      kind: TRANSPORT_KIND_PAYLOAD,
      cloud_conn_id: cloudConnId,
      payload,
    });

    if (!forwarded) {
      this.closeAppSession(cloudConnId, {
        close_code: UNAVAILABLE_CLOSE_CODE,
        close_reason: "server_unavailable",
        notify_server: false,
      });
    }
  }

  handleServerDisconnect(serverSocket, reason) {
    if (!this.serverSession || this.serverSession.socket !== serverSocket) {
      return;
    }

    this.serverSession = null;
    this.closeAllAppSessions(reason);
  }

  closeAllAppSessions(reason) {
    for (const cloudConnId of Array.from(this.appSessions.keys())) {
      this.closeAppSession(cloudConnId, {
        close_code: UNAVAILABLE_CLOSE_CODE,
        close_reason: reason,
        notify_server: false,
      });
    }
  }

  closeEntireBoat(reason) {
    this.closeAllAppSessions(reason);
    if (this.serverSession) {
      const currentServer = this.serverSession;
      this.serverSession = null;
      closeSocket(currentServer.socket, UNAVAILABLE_CLOSE_CODE, reason);
    }
  }

  closeAppSession(
    cloudConnId,
    { close_code = NORMAL_CLOSE_CODE, close_reason = "closed", notify_server = false } = {},
  ) {
    const appSession = this.appSessions.get(cloudConnId);
    if (!appSession) {
      return;
    }

    this.appSessions.delete(cloudConnId);

    if (notify_server) {
      this.sendToServer({
        kind: TRANSPORT_KIND_CLOSE,
        cloud_conn_id: cloudConnId,
        reason: close_reason,
      });
    }

    closeSocket(appSession.socket, close_code, close_reason);
  }

  failClosedServer(reason) {
    const currentServer = this.serverSession;
    if (!currentServer) {
      return;
    }

    this.serverSession = null;
    closeSocket(currentServer.socket, INTERNAL_ERROR_CLOSE_CODE, reason);
    this.closeAllAppSessions(reason);
  }

  sendToServer(message) {
    if (!this.hasActiveServer()) {
      return false;
    }

    try {
      this.serverSession.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.failClosedServer("server_unavailable");
      return false;
    }
  }

  hasActiveServer() {
    return this.serverSession && this.serverSession.socket.readyState === 1;
  }

  allocateCloudConnId() {
    const cloudConnId = `c_${this.nextCloudConnId}`;
    this.nextCloudConnId += 1;
    return cloudConnId;
  }
}

async function issueWsTicket(request, env) {
  if (!hasRegistryBinding(env)) {
    return jsonError("SERVER_ERROR", "BOAT_REGISTRY durable object binding missing", 500);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  return postToRegistry(env, INTERNAL_ISSUE_TICKET_PATH, body.value);
}

async function updateBoatSecret(request, env) {
  if (!hasRegistryBinding(env)) {
    return jsonError("SERVER_ERROR", "BOAT_REGISTRY durable object binding missing", 500);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const response = await postToRegistry(env, INTERNAL_UPDATE_SECRET_PATH, body.value);
  if (response.ok) {
    const boatId = requireNonEmptyString(body.value.boat_id);
    if (boatId) {
      await postToBoatPipe(env, boatId, INTERNAL_SECRET_ROTATED_PATH, { reason: "secret_rotated" });
    }
  }
  return response;
}

async function handlePipe(request, env, cors) {
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
    return jsonError("UPGRADE_REQUIRED", "WebSocket upgrade required", 426, cors);
  }

  if (!hasRegistryBinding(env)) {
    return jsonError("SERVER_ERROR", "BOAT_REGISTRY durable object binding missing", 500, cors);
  }
  if (!hasBoatPipeBinding(env)) {
    return jsonError("SERVER_ERROR", "BOAT_PIPE durable object binding missing", 500, cors);
  }

  const url = new URL(request.url);
  const wsTicket = requireNonEmptyString(url.searchParams.get("ticket"));
  if (!wsTicket) {
    return jsonError("AUTH_FAILED", "ticket query param required", 401, cors);
  }

  const redeemResponse = await postToRegistry(env, INTERNAL_REDEEM_TICKET_PATH, {
    ws_ticket: wsTicket,
  });
  if (!redeemResponse.ok) {
    return withCors(redeemResponse, cors);
  }

  const ticketClaims = await redeemResponse.json();
  const boatId = ticketClaims.boat_id;
  const role = ticketClaims.role;
  const internalUrl = new URL(request.url);
  internalUrl.pathname = INTERNAL_PIPE_PATH;
  internalUrl.search = "";

  const headers = new Headers(request.headers);
  headers.set("x-relay-boat-id", boatId);
  headers.set("x-relay-role", role);
  headers.set("x-relay-ticket-id", wsTicket);

  const relayRequest = new Request(internalUrl.toString(), {
    method: "GET",
    headers,
  });

  const stub = env.BOAT_PIPE.get(env.BOAT_PIPE.idFromName(boatId));
  const response = await stub.fetch(relayRequest);
  if (response.status === 101) {
    return response;
  }
  return withCors(response, cors);
}

async function postToRegistry(env, path, body) {
  const stub = env.BOAT_REGISTRY.get(env.BOAT_REGISTRY.idFromName(REGISTRY_OBJECT_NAME));
  const request = new Request(`https://registry${path}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return stub.fetch(request);
}

async function postToBoatPipe(env, boatId, path, body) {
  if (!hasBoatPipeBinding(env)) {
    return null;
  }
  const stub = env.BOAT_PIPE.get(env.BOAT_PIPE.idFromName(boatId));
  const request = new Request(`https://pipe${path}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return stub.fetch(request);
}

function hasBoatPipeBinding(env) {
  return env.BOAT_PIPE && typeof env.BOAT_PIPE.idFromName === "function";
}

function hasRegistryBinding(env) {
  return env.BOAT_REGISTRY && typeof env.BOAT_REGISTRY.idFromName === "function";
}

function parsePreconfiguredBoatMap(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return new Map();
  }

  const parsed = JSON.parse(trimmed);
  const map = new Map();

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const normalized = normalizeBoatSeedRecord(entry);
      if (normalized) {
        map.set(normalized.boat_id, normalized);
      }
    }
    return map;
  }

  if (isPlainObject(parsed)) {
    for (const [boatId, entry] of Object.entries(parsed)) {
      const normalized = normalizeBoatSeedRecord(entry, boatId);
      if (normalized) {
        map.set(normalized.boat_id, normalized);
      }
    }
    return map;
  }

  throw new Error("PRECONFIGURED_BOATS_JSON must be an array or object");
}

function normalizeBoatSeedRecord(entry, boatIdHint = "") {
  if (typeof entry === "string") {
    const boatId = requireNonEmptyString(boatIdHint);
    const cloudSecret = requireNonEmptyString(entry);
    if (!boatId || !cloudSecret) {
      return null;
    }
    return {
      boat_id: boatId,
      cloud_secret: cloudSecret,
      state: BOAT_STATE_CLOUD_READY,
      enabled: true,
    };
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const boatId = requireNonEmptyString(entry.boat_id || boatIdHint);
  const cloudSecret = requireNonEmptyString(entry.cloud_secret || entry.boat_secret || entry.secret);
  const state = normalizeBoatState(entry.state, cloudSecret ? BOAT_STATE_CLOUD_READY : BOAT_STATE_LOCAL_READY);
  if (!boatId) {
    return null;
  }
  if (state === BOAT_STATE_CLOUD_READY && !cloudSecret) {
    return null;
  }

  return {
    boat_id: boatId,
    cloud_secret: cloudSecret || "",
    state,
    enabled: entry.enabled !== false,
  };
}

function normalizeBoatState(value, fallback) {
  return value === BOAT_STATE_SETUP_REQUIRED || value === BOAT_STATE_LOCAL_READY || value === BOAT_STATE_CLOUD_READY
    ? value
    : fallback;
}

async function hashSecret(secret) {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexFromArrayBuffer(digest);
}

async function secretMatches(secret, expectedHash) {
  if (!expectedHash) {
    return false;
  }
  return (await hashSecret(secret)) === expectedHash;
}

function hexFromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function getWsTicketTtlMs(env) {
  const raw = Number(env.WS_TICKET_TTL_MS || DEFAULT_WS_TICKET_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_WS_TICKET_TTL_MS;
  }
  return Math.min(Math.max(Math.trunc(raw), 1_000), MAX_WS_TICKET_TTL_MS);
}

async function readJsonBody(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonError("INVALID_JSON", "Request body must be valid JSON", 400),
    };
  }
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function jsonError(code, message, status, headers = {}) {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
    headers,
  );
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function safeParseJsonObject(raw) {
  if (typeof raw !== "string" || !raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeRole(value) {
  return value === ROLE_APP || value === ROLE_SERVER ? value : "";
}

function requireNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function requireOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function closeSocket(socket, code, reason) {
  try {
    if (socket && socket.readyState === 1) {
      socket.close(code, sanitizeCloseReason(reason) || "closed");
    }
  } catch {
    // Ignore close failures during cleanup.
  }
}

function sanitizeCloseReason(reason) {
  const normalized = requireNonEmptyString(reason);
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, 120);
}

function boatStorageKey(boatId) {
  return `${BOAT_KEY_PREFIX}${boatId}`;
}

function ticketStorageKey(ticket) {
  return `${TICKET_KEY_PREFIX}${ticket}`;
}
