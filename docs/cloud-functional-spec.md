# Cloud Relay Functional Spec

Status: active  
Date: 2026-03-25  
Related wire contract: [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md)  
Related server behavior: [`docs/server-functional-spec.md`](/home/pm/dev/anchormaster/docs/server-functional-spec.md)  
Related access lifecycle: [`docs/access-and-provisioning.md`](/home/pm/dev/anchormaster/docs/access-and-provisioning.md)

## Purpose

Define what the cloud proxy must do functionally for the current preconfigured-boat setup.

This is a behavior spec for the cloud relay layer. It does not define boat business logic, runtime state, or the app/server v2 business protocol itself.

## Scope Assumptions

This document assumes:

- boats are preconfigured in the cloud relay auth store
- each allowed boat already has a configured `boat_id`
- each boat is in either `SETUP_REQUIRED`, `LOCAL_READY`, or `CLOUD_READY`
- there is no user/OAuth control plane in this phase
- boat creation is out of scope for the relay in this phase

Later user-account and boat-management flows may replace this bootstrap model, but this document defines the current functional target for the cloud proxy.

## System Context

Topology:

`app <-> cloud relay <-> server`

Where:

- many boats share one relay deployment
- each boat may have many app clients
- each boat has at most one authoritative cloud-connected server at a time
- the relay is never authoritative for boat state, config, track, or alarm behavior

## Core Responsibilities

The cloud relay must:

- authenticate cloud access for preconfigured boats
- support many boats concurrently in one relay deployment
- isolate traffic by boat
- preserve separate app request/reply sessions for the same boat
- forward opaque v2 business payloads between apps and the server
- clean up cloud sessions deterministically on disconnect
- expose a boat-secret rotation endpoint for the current preconfigured setup

The cloud relay must not:

- create boats implicitly
- parse or validate business `req_id`, `type`, or `data`
- store or derive runtime state
- merge config, track, or alarm data
- become authoritative for connection-scoped request lifecycle beyond transport cleanup

## Identity Model

### Boat registry

The relay must have a persistent registry of allowed boats.

Each boat record must include at least:

- `boat_id`
- boat lifecycle state such as `SETUP_REQUIRED`, `LOCAL_READY`, or `CLOUD_READY`
- runtime `cloud_secret` hash when cloud is configured
- enabled/disabled status

Rules:

- `boat_id` is a non-secret routing key
- runtime `cloud_secret` is the boat-scoped cloud credential
- only preconfigured, enabled boats are allowed to use the relay
- unknown boats must be rejected
- disabled boats must be rejected
- the shared factory setup PIN is not a normal runtime cloud credential
- initial local BLE onboarding must not go through the relay

## Connection Model

The relay must use one durable object per `boat_id`.

Each boat durable object manages:

- zero or one active server cloud socket
- zero or many active app cloud sockets
- per-app cloud session identifiers

Rules:

- app sockets for one boat must never see payloads for another boat
- server payloads for one boat must never be forwarded to another boat
- each app cloud socket is its own independent request/reply session to the server
- duplicated streamed data across multiple app sessions is acceptable for now

## Authentication Flow

Browser WebSocket auth must not rely on custom request headers.

The relay therefore exposes a short-lived WebSocket ticket flow over normal HTTPS.

### 1. `POST /v1/ws-ticket`

Purpose:

- authenticate a cloud participant
- mint a short-lived WebSocket ticket for one boat and one role

Request body:

```json
{
  "boat_id": "BOAT_123",
  "cloud_secret": "secret",
  "role": "app"
}
```

Allowed roles:

- `app`
- `server`

Rules:

- the boat must already exist in the relay registry
- the boat must already be in `CLOUD_READY`
- the supplied secret must match the current boat secret
- the relay must return a short-lived ticket bound to:
  - `boat_id`
  - `role`
  - expiry time
- the relay should make tickets single-use when practical
- tickets should expire quickly, for example within 60 seconds

Example response:

```json
{
  "boat_id": "BOAT_123",
  "role": "app",
  "ws_ticket": "ticket_value",
  "expires_at": 1770897600000
}
```

### 2. `GET /v1/pipe?ticket=...`

Purpose:

- establish the WebSocket connection after ticket issuance

Rules:

- the relay validates the ticket before accepting the socket
- the ticket resolves the authoritative `boat_id` and `role`
- the relay must reject expired, invalid, or already-used tickets
- the relay must attach the accepted socket to the durable object for the resolved `boat_id`

### 3. `POST /v1/update-boat-secret`

Purpose:

- configure or rotate the per-boat cloud secret

Request body:

```json
{
  "boat_id": "BOAT_123",
  "old_secret": "old_secret",
  "new_secret": "new_secret"
}
```

Rules:

- the boat must already exist
- if the boat is already in `CLOUD_READY`, `old_secret` must match the current configured cloud secret
- if the boat is in `LOCAL_READY` and does not yet have a cloud secret, the relay may accept the first non-empty `new_secret` without `old_secret`
- `new_secret` must be validated as non-empty and acceptable for storage
- the relay must replace the stored secret atomically
- once a cloud secret is configured, the boat becomes `CLOUD_READY`
- tickets issued before rotation may remain valid until their normal expiry
- tickets issued after rotation must require the new secret
- after rotation the relay should close active sockets for that boat so all sessions must reconnect with the new secret

This endpoint is the current pre-control-plane cloud-secret management path. A later user-account control plane may replace it.

## Boat Durable Object Behavior

Each boat durable object is a transport router for exactly one boat.

It must:

- keep the current server socket, if any
- keep all current app sockets
- allocate a stable relay-scoped `cloud_conn_id` per app session
- forward transport-wrapped payloads between the server socket and the matching app socket
- tear down session state immediately on socket close/error

It must not:

- inspect the inner v2 business payload
- store replay buffers
- synthesize boat business responses

## Session Isolation

One server cloud socket must be able to serve many app sessions for the same boat.

To preserve separate app request/reply sessions, the relay must multiplex app traffic toward the server using a relay transport envelope.

This envelope is outside the v2 business protocol.

### Relay transport envelope

The server-facing cloud socket must carry messages shaped like:

```json
{
  "kind": "PAYLOAD",
  "cloud_conn_id": "c_123",
  "payload": {
    "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9",
    "type": "GET_DATA",
    "data": {}
  }
}
```

Supported transport kinds:

- `OPEN`
- `PAYLOAD`
- `CLOSE`

Rules:

- `cloud_conn_id` is assigned by the relay
- the inner `payload` is the unchanged v2 business message
- the relay must never rewrite the inner business payload

### `OPEN`

Sent by the relay to the server when a new app cloud session is established.

Example:

```json
{
  "kind": "OPEN",
  "cloud_conn_id": "c_123"
}
```

### `PAYLOAD`

Sent:

- by the relay to the server for app business messages
- by the server to the relay for app-targeted business replies

Rules:

- the relay forwards server `PAYLOAD` messages only to the matching app session
- the relay forwards app business messages only to the authoritative server socket for that boat

### `CLOSE`

Sent when an app cloud session ends or must be terminated.

Example:

```json
{
  "kind": "CLOSE",
  "cloud_conn_id": "c_123",
  "reason": "app_disconnected"
}
```

Rules:

- when an app socket disconnects, the relay must send `CLOSE` to the server
- when the server requests `CLOSE`, the relay must close the matching app socket
- when the server socket disconnects, the relay must close all app sockets for that boat

## Server Socket Rules

Per boat:

- at most one server socket may be active at a time

If a second server socket connects for the same boat:

- the relay must resolve that deterministically
- recommended policy: newest server socket wins
- when replacing the active server socket, the relay must close all app sockets for that boat so request lifecycles are not silently transferred across server instances

If no server socket is active:

- new app sockets must fail fast or be closed promptly with a transport-level reason such as `SERVER_UNAVAILABLE`
- the relay must not buffer business payloads while waiting for a server

## Failure Handling

The relay must fail closed.

Examples:

- invalid boat secret -> ticket request rejected
- unknown boat -> ticket request rejected
- invalid ticket -> WebSocket upgrade rejected
- missing server socket -> app socket refused or promptly closed
- malformed relay transport envelope on the server socket -> close that server socket

Business payload failures remain the server's responsibility. The relay does not generate business `ERROR` replies.

## Out of Scope

This document does not define:

- boat creation flows
- user accounts or OAuth
- user-to-boat memberships
- long-term credential recovery UX
- the boat/server runtime behavior
- the v2 business request/reply payloads themselves

Those belong in separate control-plane, server, and protocol specs.

## Acceptance Criteria

The cloud relay functional spec is satisfied when all of the following are true:

- one relay deployment can handle many boats at the same time
- traffic is isolated by `boat_id`
- only preconfigured boats with matching secrets can obtain WebSocket tickets
- the relay uses one durable object per boat
- each boat has at most one active server socket
- one boat can have many concurrent app sockets
- separate app cloud sessions remain distinct end-to-end
- the relay forwards inner v2 payloads unchanged
- the relay never stores or derives business state
- server disconnect closes all app sessions for that boat deterministically
- boat secret rotation works through `POST /v1/update-boat-secret`
