import type { JsonRecord } from "../../core/types";

export function deriveBleStatusText(connected: boolean, authState: JsonRecord | null): string {
  if (!connected) {
    return "disconnected";
  }
  const auth = authState ?? {};
  const paired = auth.sessionPaired ? "paired" : "unpaired";
  const pairMode = auth.pairModeActive ? "pair-mode-on" : "pair-mode-off";
  return `connected (${paired}, ${pairMode})`;
}
