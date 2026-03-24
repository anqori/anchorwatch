import { Capacitor } from "@capacitor/core";
import { CONNECTION_RUNTIME_MODE_REMOTE } from "../core/constants";
import { readCloudCredentials } from "../state/app-state.svelte";
import type { ConnectionRuntimeMode } from "../core/types";
import { DeviceConnectionBle } from "./ble/device-connection-ble";
import { DeviceConnectionBleNative } from "./ble/device-connection-ble-native";
import type { DeviceConnectionBleLike } from "./ble/device-connection-ble-like";
import { DeviceConnectionRelayCloud } from "./cloud/device-connection-relay-cloud";
import type { DeviceConnection } from "./device-connection";

const bleConnection: DeviceConnectionBleLike = Capacitor.isNativePlatform()
  ? new DeviceConnectionBleNative()
  : new DeviceConnectionBle();
const relayCloudConnection = new DeviceConnectionRelayCloud(readCloudCredentials);

export function getBluetoothConnection(): DeviceConnectionBleLike {
  return bleConnection;
}

export function getRelayCloudConnection(): DeviceConnectionRelayCloud {
  return relayCloudConnection;
}

export function defaultConnectionForRuntimeMode(
  runtimeMode: ConnectionRuntimeMode = CONNECTION_RUNTIME_MODE_REMOTE,
): DeviceConnection {
  if (runtimeMode === "onboard") {
    return bleConnection;
  }
  return relayCloudConnection;
}
