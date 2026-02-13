import { PROTOCOL_VERSION } from "../core/constants";
import { ensurePhoneId } from "../services/persistence-domain";
import { readCloudCredentials } from "../state/app-state.svelte";
import type { Mode } from "../core/types";
import { DeviceConnectionBle } from "./device-connection-ble";
import { DeviceConnectionFake } from "./device-connection-fake";
import { DeviceConnectionRelayCloud } from "./device-connection-relay-cloud";
import type { DeviceConnection } from "./device-connection";

const bleConnection = new DeviceConnectionBle();
const relayCloudConnection = new DeviceConnectionRelayCloud(readCloudCredentials, ensurePhoneId, PROTOCOL_VERSION);
const fakeConnection = new DeviceConnectionFake();

export function getBluetoothConnection(): DeviceConnectionBle {
  return bleConnection;
}

export function getRelayCloudConnection(): DeviceConnectionRelayCloud {
  return relayCloudConnection;
}

export function getFakeConnection(): DeviceConnectionFake {
  return fakeConnection;
}

export function defaultConnectionForMode(mode: Mode): DeviceConnection {
  if (mode === "fake") {
    return fakeConnection;
  }
  return relayCloudConnection;
}
