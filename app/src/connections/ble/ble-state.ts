import type { JsonRecord } from "../../core/types";
import type { DeviceConnectionPhase } from "../device-connection";

export function deriveBleStatusText(connected: boolean, authState: JsonRecord | null, phase: DeviceConnectionPhase = connected ? "connected" : "disconnected"): string {
  if (phase === "connecting") {
    return "connecting";
  }
  if (!connected) {
    return "disconnected";
  }
  const auth = authState ?? {};
  const pairMode = auth.pair_mode_active === true ? "pair-mode-on" : "pair-mode-off";
  return `connected (${pairMode})`;
}
