import type { BleState, JsonRecord } from "../core/types";

export function deriveBleStatusText(connected: boolean, authState: JsonRecord | null): string {
  if (!connected) {
    return "disconnected";
  }
  const auth = authState ?? {};
  const paired = auth.sessionPaired ? "paired" : "unpaired";
  const pairMode = auth.pairModeActive ? "pair-mode-on" : "pair-mode-off";
  return `connected (${paired}, ${pairMode})`;
}

export function resetBleConnectionState(ble: BleState): void {
  ble.connected = false;
  ble.device = null;
  ble.server = null;
  ble.service = null;
  ble.controlTx = null;
  ble.eventRx = null;
  ble.snapshot = null;
  ble.auth = null;
  ble.authState = null;
  ble.chunkAssemblies.clear();
}
