# Access And Provisioning

Status: active  
Date: 2026-03-25  
Related wire contract: [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md)  
Related server behavior: [`docs/server-functional-spec.md`](/home/pm/dev/anchormaster/docs/server-functional-spec.md)  
Related cloud relay behavior: [`docs/cloud-functional-spec.md`](/home/pm/dev/anchormaster/docs/cloud-functional-spec.md)  
Related firmware details: [`docs/server-firmware-spec.md`](/home/pm/dev/anchormaster/docs/server-firmware-spec.md)

## Purpose

Define the current access-control and provisioning model for:

- hardware devices
- BLE onboarding
- app enrollment
- cloud relay credential flow

This is the active pre-control-plane model.

## Three Credentials Model

The current system uses three separate credentials with different roles.

### 1. `factory_setup_pin`

- shared across devices in the current bring-up phase
- flashed into firmware
- BLE-only
- usable only while the boat is in first-setup state
- never accepted by the cloud relay for normal runtime access
- never accepted for normal runtime boat control

### 2. `ble_connection_pin`

- per-boat local control credential
- used to authorize BLE sessions after first setup
- changeable later from an already authorized BLE session
- never used by the cloud relay

### 3. `cloud_secret`

- per-boat cloud credential
- used only for cloud relay authentication
- stored on device
- readable by an already authorized BLE session
- stored locally by the app whenever that app connects via BLE and is authorized

Do not collapse these into one credential.

Reason:

- factory bootstrap, local control, and cloud access are different trust boundaries
- initial setup must not depend on cloud setup
- cloud access must not depend on a shared flashed secret

## Boat Access States

Each boat is in one of these states:

### `SETUP_REQUIRED`

- device does not yet have a real `ble_connection_pin`
- local BLE setup flow is allowed
- normal runtime access is blocked
- cloud access is blocked

### `LOCAL_READY`

- `ble_connection_pin` is configured
- normal BLE access may proceed after BLE session authorization
- `cloud_secret` may still be unset or not yet usable
- the boat can already work locally

### `CLOUD_READY`

- `ble_connection_pin` is configured
- cloud identity/secret are configured
- cloud relay access may proceed

## Session Access States

Each BLE session is in one of these states:

### `UNAUTHORIZED`

- connected to BLE
- not yet allowed to use protected functionality

### `AUTHORIZED`

- session has proven the current `ble_connection_pin`
- protected reads/writes are allowed over BLE

Cloud sessions do not use the BLE pin. They are authorized by the cloud relay using `boat_id + cloud_secret`.

## Base Hardware Configuration

Device bring-up baseline:

- stable `device_id`
- stable initial `boat_id` or preassigned boat identifier
- shared flashed `factory_setup_pin`
- `ble_connection_pin` unset
- `cloud_secret` may be unset or preprovisioned depending on phase

Behavior at this stage:

- device starts in `SETUP_REQUIRED`
- BLE onboarding is available
- the app may not use the shared factory setup PIN for normal runtime functionality
- the cloud relay must not issue normal runtime tickets from the factory setup PIN

## Initial Setup Via BLE From App / Phone A

Goal:

- leave `SETUP_REQUIRED`
- choose the boat's real `ble_connection_pin`
- make the boat usable locally over BLE

Flow:

1. Phone A connects over BLE.
2. App detects `SETUP_REQUIRED`.
3. User enters the shared factory setup PIN.
4. App uses a BLE-only setup authorization step.
5. App requires the user to choose a new `ble_connection_pin`.
6. App sends the new BLE pin to the boat.
7. Boat leaves `SETUP_REQUIRED` and enters `LOCAL_READY`.
8. Current BLE session becomes authorized.
9. App can now use normal BLE runtime functionality.

Rules:

- initial setup does not require cloud setup
- initial setup does not require the proxy
- after the boat has left `SETUP_REQUIRED`, `AUTHORIZE_SETUP` and `SET_INITIAL_BLE_PIN` must fail with `INVALID_STATE`
- no normal boat functionality is allowed while the shared factory setup PIN is still the only local credential

## Joining The Boat From Another App / Phone B

Goal:

- app B learns the current BLE and cloud credentials without manual cloud-secret entry
- app B becomes able to use both BLE and cloud

BLE join flow:

1. Phone B connects over BLE.
2. Session starts `UNAUTHORIZED`.
3. User enters the current `ble_connection_pin`.
4. App sends the BLE-session authorization request.
5. On success, the BLE session becomes `AUTHORIZED`.
6. The device sends the current `CONFIG_CLOUD` value to the app.
7. App stores the received `boat_id + cloud_secret` locally.

Result:

- phone B can use BLE immediately
- later proxy/cloud access works without the user manually typing `cloud_secret`

## Cloud Setup And Sync

Cloud setup is separate from initial onboarding.

Goal:

- configure WLAN/cloud access after the boat already works locally

Rules:

- the device remains usable locally in `LOCAL_READY` even if cloud is not configured yet
- cloud config should be handled alongside WLAN/cloud setup, not as part of the first BLE onboarding step
- once a BLE session is authorized, the app should always refresh its local copy of `CONFIG_CLOUD`
- in the current PWA flow, the user enters the cloud secret alongside WLAN target settings, but the protocol still applies it through separate `UPDATE_CONFIG_WLAN` and `UPDATE_CLOUD_CREDENTIALS` requests

Practical consequence:

- client B does not need a separate manual cloud-secret entry step
- whenever a client connects via BLE and authorizes successfully, the app updates its local `cloud_secret` from the server/device

## Updating The BLE Pin

Goal:

- rotate the local BLE control credential

Flow:

1. App A already has an authorized BLE session.
2. User enters a new `ble_connection_pin`.
3. App sends the BLE-pin update request.
4. On success, existing BLE sessions should be invalidated and must reauthorize with the new pin.

## Updating The Cloud Secret

Goal:

- rotate the cloud relay credential independently from the BLE pin

Flow:

1. App A already has an authorized BLE session.
2. User updates the cloud secret through the cloud/WLAN management flow.
3. App updates the proxy over HTTPS.
4. App updates the device cloud config over BLE.
5. On later BLE connects, all apps refresh the new `cloud_secret` from `CONFIG_CLOUD`.

## What Happens To Phone B After A Change

### If A changes the BLE pin

- phone B must reauthorize over BLE with the new `ble_connection_pin`
- cloud access can keep working if `cloud_secret` did not change

### If A changes the cloud secret

- phone B's old cloud tickets fail
- the next authorized BLE connect refreshes the new `cloud_secret` into app B automatically

## Long-Term Direction

Later, with user accounts and explicit boat creation:

1. user creates the boat in the cloud frontend
2. frontend manages the authoritative cloud identity and `cloud_secret`
3. app still provisions the boat locally over BLE using:
   - `factory_setup_pin`
   - then `ble_connection_pin`
4. normal BLE and cloud sessions remain separate:
   - BLE uses `ble_connection_pin`
   - cloud uses `cloud_secret`

The three-credential model remains valid:

- factory setup PIN for first local bootstrap
- BLE connection PIN for local control
- cloud secret for relay access
