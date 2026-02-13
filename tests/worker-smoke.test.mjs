import assert from "node:assert/strict";
import test from "node:test";

const { default: worker } = await import(new URL("../cloud/worker/src/index.js", import.meta.url));

function createBoatPipeBinding(handler) {
  const calls = [];
  return {
    calls,
    binding: {
      idFromName(name) {
        return `id:${name}`;
      },
      get(id) {
        return {
          async fetch(request) {
            calls.push({ id, request });
            return handler(request, id);
          },
        };
      },
    },
  };
}

async function fetchWorker(path, { method = "GET", headers = {}, env = {} } = {}) {
  const request = new Request(`https://example.invalid${path}`, { method, headers });
  return worker.fetch(request, env);
}

test("/v1/pipe requires WebSocket upgrade", async () => {
  const response = await fetchWorker("/v1/pipe?boatId=boat_demo_001", {
    env: { BOAT_PIPE: createBoatPipeBinding(() => new Response(null, { status: 200 })).binding },
  });
  assert.equal(response.status, 426);
  const body = await response.json();
  assert.equal(body.error.code, "UPGRADE_REQUIRED");
});

test("/v1/pipe enforces boat secret when configured", async () => {
  const response = await fetchWorker("/v1/pipe?boatId=boat_demo_001", {
    headers: { upgrade: "websocket" },
    env: {
      BOAT_SECRET: "expected_secret",
      BOAT_PIPE: createBoatPipeBinding(() => new Response(null, { status: 200 })).binding,
    },
  });

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "AUTH_FAILED");
});

test("/v1/pipe forwards valid websocket requests to per-boat durable object", async () => {
  const boatPipe = createBoatPipeBinding(() => new Response(null, { status: 200 }));

  const response = await fetchWorker(
    "/v1/pipe?boatId=boat_demo_001&deviceId=phone_123&role=app&boatSecret=secret_123",
    {
      headers: { upgrade: "websocket" },
      env: {
        BOAT_SECRET: "secret_123",
        BOAT_PIPE: boatPipe.binding,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(boatPipe.calls.length, 1);
  assert.equal(boatPipe.calls[0].id, "id:boat_demo_001");
  assert.equal(new URL(boatPipe.calls[0].request.url).pathname, "/v1/pipe");
});

test("/v1/pipe enforces optional BOAT_ID scope", async () => {
  const response = await fetchWorker("/v1/pipe?boatId=boat_other&boatSecret=secret_123", {
    headers: { upgrade: "websocket" },
    env: {
      BOAT_SECRET: "secret_123",
      BOAT_ID: "boat_expected",
      BOAT_PIPE: createBoatPipeBinding(() => new Response(null, { status: 200 })).binding,
    },
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "AUTH_FAILED");
});

test("unknown endpoints return NOT_FOUND", async () => {
  const response = await fetchWorker("/health");
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "NOT_FOUND");
});
