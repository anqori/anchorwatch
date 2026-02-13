import assert from "node:assert/strict";
import test from "node:test";

const { default: worker } = await import(new URL("../cloud/worker/src/index.js", import.meta.url));

function randomBoatId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function createMockKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

async function postJson(path, body, env = {}) {
  const request = new Request(`https://example.invalid${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, env);
}

async function getJson(path, env = {}) {
  const request = new Request(`https://example.invalid${path}`, { method: "GET" });
  return worker.fetch(request, env);
}

test("health endpoint responds with ok=true", async () => {
  const response = await getJson("/health");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, "anchorwatch-relay");
  assert.equal(data.storage, "memory");
});

test("state patch accepts dot-path map and reads back snapshot", async () => {
  const boatId = randomBoatId("boat_state");

  const ingest = await postJson("/v1/state", {
    boatId,
    msgType: "status.patch",
    statePatch: {
      "telemetry.gps.lat": 54.3201,
      "telemetry.gps.lon": 10.1402,
      "telemetry.motion.sogKn": 0.42,
    },
  });
  assert.equal(ingest.status, 202);

  const snapshotResponse = await getJson(`/v1/state?boatId=${encodeURIComponent(boatId)}`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.msgType, "status.snapshot");
  assert.equal(snapshot.payload.snapshot.telemetry.gps.lat, 54.3201);
  assert.equal(snapshot.payload.snapshot.telemetry.gps.lon, 10.1402);
  assert.equal(snapshot.payload.snapshot.telemetry.motion.sogKn, 0.42);
});

test("config patch supports mixed nested + dot-path and enforces version monotonicity", async () => {
  const boatId = randomBoatId("boat_config");

  const firstPatch = await postJson("/v1/config", {
    boatId,
    msgType: "config.patch",
    version: 1,
    patch: {
      "zone.type": "circle",
      network: {
        wifi: {
          ssid: "BoatHotspot",
        },
      },
    },
  });
  assert.equal(firstPatch.status, 202);

  const snapshotResponse = await getJson(`/v1/config?boatId=${encodeURIComponent(boatId)}`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.msgType, "config.snapshot");
  assert.equal(snapshot.payload.version, 1);
  assert.equal(snapshot.payload.config.zone.type, "circle");
  assert.equal(snapshot.payload.config.network.wifi.ssid, "BoatHotspot");

  const conflicting = await postJson("/v1/config", {
    boatId,
    msgType: "config.patch",
    version: 1,
    patch: {
      "zone.circle.radiusM": 50,
    },
  });
  assert.equal(conflicting.status, 409);
  const conflictBody = await conflicting.json();
  assert.equal(conflictBody.error.code, "VERSION_CONFLICT");
});

test("state patch uses per-field LWW with durable KV backend and keeps tracks compact", async () => {
  const boatId = randomBoatId("boat_lww");
  const env = { RELAY_KV: createMockKv(), TRACK_MAX_POINTS: "20" };

  const newer = await postJson("/v1/state", {
    boatId,
    msgType: "status.patch",
    ts: 2000,
    statePatch: {
      "telemetry.gps.lat": 54.1234,
      "telemetry.gps.lon": 10.5678,
      "telemetry.motion.sogKn": 1.2,
    },
  }, env);
  assert.equal(newer.status, 202);

  const older = await postJson("/v1/state", {
    boatId,
    msgType: "status.patch",
    ts: 1500,
    statePatch: {
      "telemetry.gps.lat": 53.9,
      "telemetry.gps.lon": 9.9,
      "telemetry.wind.knots": 18,
    },
  }, env);
  assert.equal(older.status, 202);

  const snapshotResponse = await getJson(`/v1/state?boatId=${encodeURIComponent(boatId)}`, env);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();

  // Older patch cannot overwrite newer GPS fields.
  assert.equal(snapshot.payload.snapshot.telemetry.gps.lat, 54.1234);
  assert.equal(snapshot.payload.snapshot.telemetry.gps.lon, 10.5678);
  // Per-field LWW still allows older patch to populate previously unset fields.
  assert.equal(snapshot.payload.snapshot.telemetry.wind.knots, 18);

  const tracksResponse = await getJson(`/v1/tracks?boatId=${encodeURIComponent(boatId)}`, env);
  assert.equal(tracksResponse.status, 200);
  const tracks = await tracksResponse.json();
  assert.equal(tracks.payload.points.length, 1);
  assert.equal(tracks.payload.points[0].lat, 54.1234);
  assert.equal(tracks.payload.points[0].lon, 10.5678);

  const health = await getJson("/health", env);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.storage, "kv");
});
