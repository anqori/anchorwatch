// Durable-first storage: use Cloudflare KV when RELAY_KV binding is configured.
// Fall back to in-memory maps only for local test/dev runs without KV binding.
const memoryLatestStateByBoat = new Map();
const memoryLatestConfigByBoat = new Map();
const memoryTrackPointsByBoat = new Map();
const KV_PREFIX = "am.v1";
const BUILD_VERSION_DEFAULT = "run-unknown";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env.ALLOWED_ORIGIN || "*");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      const buildVersion = String(env.BUILD_VERSION || BUILD_VERSION_DEFAULT);
      return json(
        {
          ok: true,
          service: "anchorwatch-relay",
          buildVersion,
          storage: storageMode(env),
          now: new Date().toISOString(),
        },
        200,
        cors,
      );
    }

    // KISS auth model: one shared boat secret for protected API calls.
    if (url.pathname.startsWith("/v1/")) {
      const authError = authorizeRequest(request, env, cors);
      if (authError) {
        return authError;
      }
    }

    if (url.pathname === "/v1/state" && request.method === "GET") {
      const boatId = url.searchParams.get("boatId");
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

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      const entry = await readLatestEntry(env, "state", boatId);
      if (!entry) {
        return json(
          {
            ok: false,
            error: { code: "NOT_FOUND", detail: "no state for boatId" },
          },
          404,
          cors,
        );
      }

      return json(
        {
          ok: true,
          ver: "am.v1",
          msgType: "status.snapshot",
          boatId,
          deviceId: entry.updatedBy,
          ts: entry.updatedAt,
          payload: {
            snapshot: entry.snapshot,
            updatedAt: entry.updatedAt,
          },
          // Compatibility fields for early app scaffolds.
          snapshot: entry.snapshot,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy,
        },
        200,
        cors,
      );
    }

    if (url.pathname === "/v1/state" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: { code: "INVALID_JSON" } }, 400, cors);
      }

      const boatId = body?.boatId;
      const deviceId = body?.deviceId || "unknown";
      const ts = safeTimestamp(body?.ts);
      const msgType = body?.msgType;
      const rawStatePatch = extractPatch(body, ["statePatch", "patch"], ["statePatch", "patch"]);
      const normalizedStatePatch = normalizePatch(rawStatePatch);
      const statePatch = normalizedStatePatch.ok ? normalizedStatePatch.patch : null;

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      if (
        !boatId ||
        (msgType && msgType !== "status.patch") ||
        !normalizedStatePatch.ok
      ) {
        return json(
          {
            ok: false,
            error: {
              code: "INVALID_PAYLOAD",
              detail:
                "boatId and object statePatch/patch required (nested object or dot-path map); if msgType is provided it must be status.patch",
            },
          },
          400,
          cors,
        );
      }

      const previous = await readLatestEntry(env, "state", boatId);
      const next = applyLatestPatchStore(previous, {
        patch: statePatch,
        ts,
        updatedBy: deviceId,
      });
      await writeLatestEntry(env, "state", boatId, next);
      await appendTrackPointFromStatePatch(env, boatId, next.snapshot, ts);

      return json(
        {
          ok: true,
          accepted: true,
          boatId,
          updatedAt: ts,
          mode: "latest-state",
        },
        202,
        cors,
      );
    }

    if (url.pathname === "/v1/config" && request.method === "GET") {
      const boatId = url.searchParams.get("boatId");
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

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      const entry = await readLatestEntry(env, "config", boatId);
      if (!entry) {
        return json(
          {
            ok: false,
            error: { code: "NOT_FOUND", detail: "no config for boatId" },
          },
          404,
          cors,
        );
      }

      return json(
        {
          ok: true,
          ver: "am.v1",
          msgType: "config.snapshot",
          boatId,
          deviceId: entry.updatedBy,
          ts: entry.updatedAt,
          payload: {
            version: entry.version,
            config: entry.snapshot,
            updatedAt: entry.updatedAt,
          },
          // Compatibility fields for early app scaffolds.
          version: entry.version,
          config: entry.snapshot,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy,
        },
        200,
        cors,
      );
    }

    if (url.pathname === "/v1/config" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: { code: "INVALID_JSON" } }, 400, cors);
      }

      const boatId = body?.boatId;
      const deviceId = body?.deviceId || "unknown";
      const ts = safeTimestamp(body?.ts);
      const msgType = body?.msgType;
      const rawConfigPatch = extractPatch(body, ["patch", "configPatch"], ["patch", "configPatch"]);
      const normalizedConfigPatch = normalizePatch(rawConfigPatch);
      const configPatch = normalizedConfigPatch.ok ? normalizedConfigPatch.patch : null;
      const version = Number(body?.version ?? body?.payload?.version);

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      if (
        !boatId ||
        (msgType && msgType !== "config.patch") ||
        !Number.isInteger(version) ||
        version < 0 ||
        !normalizedConfigPatch.ok
      ) {
        return json(
          {
            ok: false,
            error: {
              code: "INVALID_PAYLOAD",
              detail:
                "boatId, integer version>=0, and object patch/configPatch required (nested object or dot-path map); if msgType is provided it must be config.patch",
            },
          },
          400,
          cors,
        );
      }

      const previous = await readLatestEntry(env, "config", boatId);
      if (previous && Number.isInteger(previous.version) && version <= previous.version) {
        return json(
          {
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              detail: `version must be greater than current (${previous.version})`,
            },
          },
          409,
          cors,
        );
      }

      const next = applyLatestPatchStore(previous, {
        patch: configPatch,
        ts,
        updatedBy: deviceId,
        extra: { version },
      });
      await writeLatestEntry(env, "config", boatId, next);

      return json(
        {
          ok: true,
          accepted: true,
          boatId,
          version,
          updatedAt: ts,
          mode: "latest-config",
        },
        202,
        cors,
      );
    }

    if (url.pathname === "/v1/tracks" && request.method === "GET") {
      const boatId = url.searchParams.get("boatId");
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

      const scopeError = enforceBoatScope(boatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      const sinceTsRaw = Number(url.searchParams.get("sinceTs"));
      const sinceTs = Number.isFinite(sinceTsRaw) ? sinceTsRaw : null;
      const limit = clampInt(url.searchParams.get("limit"), 1, 10000, 2000);

      const allPoints = await readTrackPoints(env, boatId);
      let points = allPoints;
      if (sinceTs !== null) {
        points = points.filter((point) => point.ts >= sinceTs);
      }
      if (points.length > limit) {
        points = points.slice(points.length - limit);
      }

      return json(
        {
          ok: true,
          ver: "am.v1",
          msgType: "track.snapshot",
          boatId,
          deviceId: "cloud",
          ts: Date.now(),
          payload: {
            points,
            totalPoints: allPoints.length,
            returnedPoints: points.length,
            builtFrom: "status.patch.statePatch.telemetry.gps",
          },
          // Compatibility field for early app scaffolds.
          points,
        },
        200,
        cors,
      );
    }

    if (url.pathname === "/v1/events" && request.method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ ok: false, error: { code: "INVALID_JSON" } }, 400, cors);
      }

      const msgType = payload?.msgType || payload?.type || "";
      const payloadBoatId = payload?.boatId;
      const scopeError = enforceBoatScope(payloadBoatId, env, cors);
      if (scopeError) {
        return scopeError;
      }

      if (String(msgType).startsWith("status.")) {
        return json(
          {
            ok: false,
            error: {
              code: "WRONG_ENDPOINT",
              detail: "status updates must use /v1/state",
            },
          },
          409,
          cors,
        );
      }
      if (String(msgType).startsWith("config.")) {
        return json(
          {
            ok: false,
            error: {
              code: "WRONG_ENDPOINT",
              detail: "config updates must use /v1/config",
            },
          },
          409,
          cors,
        );
      }

      // Discrete events only (for example alarm lifecycle, acknowledgements).
      return json(
        {
          ok: true,
          accepted: true,
          receivedAt: Date.now(),
          type: msgType || "unknown",
          mode: "event-only",
        },
        202,
        cors,
      );
    }

    return json({ ok: false, error: { code: "NOT_FOUND" } }, 404, cors);
  },
};

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

function authorizeRequest(request, env, cors) {
  const expectedSecret = String(env.BOAT_SECRET || "").trim();
  if (!expectedSecret) {
    // Dev fallback: keep API open when BOAT_SECRET is not configured.
    return null;
  }

  const authHeader = request.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${expectedSecret}`;
  if (authHeader !== expectedHeader) {
    return json(
      {
        ok: false,
        error: { code: "AUTH_FAILED", detail: "invalid or missing bearer secret" },
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

function extractPatch(body, topLevelKeys, payloadKeys) {
  if (!isObject(body)) {
    return null;
  }

  for (const key of topLevelKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return body[key];
    }
  }

  if (!isObject(body.payload)) {
    return null;
  }
  for (const key of payloadKeys) {
    if (Object.prototype.hasOwnProperty.call(body.payload, key)) {
      return body.payload[key];
    }
  }
  return null;
}

function normalizePatch(rawPatch) {
  if (!isObject(rawPatch)) {
    return { ok: false };
  }
  const target = {};
  for (const [key, value] of Object.entries(rawPatch)) {
    if (!assignPatchEntry(target, key, value)) {
      return { ok: false };
    }
  }
  return { ok: true, patch: target };
}

function assignPatchEntry(target, key, value) {
  if (typeof key !== "string" || !key.length) {
    return false;
  }

  if (!key.includes(".")) {
    if (isObject(value)) {
      const nested = normalizePatch(value);
      if (!nested.ok) {
        return false;
      }
      target[key] = nested.patch;
      return true;
    }
    target[key] = value;
    return true;
  }

  const segments = key.split(".");
  if (segments.some((segment) => !segment.length)) {
    return false;
  }

  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!isObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const leaf = segments[segments.length - 1];
  if (isObject(value)) {
    const nested = normalizePatch(value);
    if (!nested.ok) {
      return false;
    }
    cursor[leaf] = nested.patch;
    return true;
  }

  cursor[leaf] = value;
  return true;
}

function applyLatestPatchStore(previousEntry, { patch, ts, updatedBy, extra = {} }) {
  const previous = isObject(previousEntry) ? previousEntry : {};
  const nextSnapshot = isObject(previous.snapshot) ? { ...previous.snapshot } : {};
  const fieldUpdatedAtByPath = isObject(previous.fieldUpdatedAtByPath)
    ? { ...previous.fieldUpdatedAtByPath }
    : {};

  const changed = applyPatchWithLww(nextSnapshot, patch, fieldUpdatedAtByPath, ts);
  const previousUpdatedAt = Number(previous.updatedAt);
  const stableUpdatedAt = Number.isFinite(previousUpdatedAt) ? previousUpdatedAt : 0;

  return {
    ...previous,
    snapshot: nextSnapshot,
    fieldUpdatedAtByPath,
    updatedAt: Math.max(stableUpdatedAt, ts),
    updatedBy: changed ? updatedBy : (previous.updatedBy || updatedBy),
    ...extra,
  };
}

function applyPatchWithLww(snapshot, patch, fieldUpdatedAtByPath, patchTs, prefix = "") {
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isObject(value)) {
      const childSnapshot = isObject(snapshot[key]) ? { ...snapshot[key] } : {};
      const childChanged = applyPatchWithLww(
        childSnapshot,
        value,
        fieldUpdatedAtByPath,
        patchTs,
        path,
      );
      snapshot[key] = childSnapshot;
      if (childChanged) {
        changed = true;
      }
      continue;
    }

    const previousTsRaw = fieldUpdatedAtByPath[path];
    const previousTs = Number(previousTsRaw);
    if (Number.isFinite(previousTs) && patchTs < previousTs) {
      continue;
    }

    snapshot[key] = value;
    fieldUpdatedAtByPath[path] = patchTs;
    changed = true;
  }

  return changed;
}

async function appendTrackPointFromStatePatch(env, boatId, statePatch, ts) {
  const gps = statePatch?.telemetry?.gps;
  if (!isObject(gps)) {
    return;
  }

  const lat = Number(gps.lat);
  const lon = Number(gps.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return;
  }

  const motion = isObject(statePatch?.telemetry?.motion) ? statePatch.telemetry.motion : {};
  const point = {
    ts,
    lat,
    lon,
    cogDeg: toFiniteOrNull(motion.cogDeg),
    headingDeg: toFiniteOrNull(motion.headingDeg),
    sogKn: toFiniteOrNull(motion.sogKn),
  };

  const points = await readTrackPoints(env, boatId);
  const last = points[points.length - 1];
  // De-duplicate unchanged position points to keep cloud track compact.
  if (last && last.lat === point.lat && last.lon === point.lon) {
    return;
  }
  points.push(point);

  const maxPoints = clampInt(env.TRACK_MAX_POINTS, 100, 50000, 10000);
  if (points.length > maxPoints) {
    points.splice(0, points.length - maxPoints);
  }
  await writeTrackPoints(env, boatId, points);
}

async function readLatestEntry(env, kind, boatId) {
  if (hasRelayKv(env)) {
    const parsed = await kvGetJson(env.RELAY_KV, kvKey(kind, boatId));
    return isObject(parsed) ? parsed : null;
  }
  return latestEntryMap(kind).get(boatId) || null;
}

async function writeLatestEntry(env, kind, boatId, entry) {
  if (hasRelayKv(env)) {
    await kvPutJson(env.RELAY_KV, kvKey(kind, boatId), entry);
    return;
  }
  latestEntryMap(kind).set(boatId, entry);
}

async function readTrackPoints(env, boatId) {
  if (hasRelayKv(env)) {
    const parsed = await kvGetJson(env.RELAY_KV, kvKey("tracks", boatId));
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (isObject(parsed) && Array.isArray(parsed.points)) {
      return parsed.points;
    }
    return [];
  }
  return memoryTrackPointsByBoat.get(boatId) || [];
}

async function writeTrackPoints(env, boatId, points) {
  if (hasRelayKv(env)) {
    await kvPutJson(env.RELAY_KV, kvKey("tracks", boatId), points);
    return;
  }
  memoryTrackPointsByBoat.set(boatId, points);
}

function latestEntryMap(kind) {
  if (kind === "state") {
    return memoryLatestStateByBoat;
  }
  if (kind === "config") {
    return memoryLatestConfigByBoat;
  }
  throw new Error(`Unsupported latest entry kind: ${kind}`);
}

function hasRelayKv(env) {
  return Boolean(
    env &&
    env.RELAY_KV &&
    typeof env.RELAY_KV.get === "function" &&
    typeof env.RELAY_KV.put === "function",
  );
}

function kvKey(kind, boatId) {
  return `${KV_PREFIX}:${kind}:${boatId}`;
}

async function kvGetJson(kv, key) {
  const raw = await kv.get(key);
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvPutJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

function storageMode(env) {
  return hasRelayKv(env) ? "kv" : "memory";
}

function safeTimestamp(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Date.now();
  }
  return parsed;
}

function toFiniteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInt(rawValue, min, max, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  if (floored < min) {
    return min;
  }
  if (floored > max) {
    return max;
  }
  return floored;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
