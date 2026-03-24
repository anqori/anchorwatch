import type { AppConnectivityState, InboundSource } from "../core/types";

export interface InternetSettingsStatusInput {
  onboardingWifiConnected: boolean;
  onboardingWifiSsid: string;
  onboardingWifiErrorText: string;
  wifiSsid: string;
  wifiScanInFlight: boolean;
  wifiScanErrorText: string;
}

export interface RelayConnectionInput {
  latestStateSource: InboundSource | "--";
  latestStateUpdatedAtMs: number;
  cloudPollMs: number;
  nowTs?: number;
}

export function hasCloudCredentialsConfigured(relayBaseUrl: string, boatId: string, cloudSecret: string): boolean {
  return Boolean(relayBaseUrl && boatId && cloudSecret);
}

export function hasConfiguredDevice(boatId: string, bleConnectionPin: string, cloudSecret: string, connectedViaBleOnce: boolean): boolean {
  const hasBoatId = boatId.trim().length > 0;
  const hasLocalCredentials = bleConnectionPin.trim().length > 0;
  const hasCloudCredentials = cloudSecret.trim().length > 0;
  return hasBoatId && (connectedViaBleOnce || hasLocalCredentials || hasCloudCredentials);
}

export function hasActiveCloudRelayConnection(input: RelayConnectionInput): boolean {
  if (input.latestStateSource !== "cloud/stream") {
    return false;
  }
  const maxAgeMs = Math.max(input.cloudPollMs * 3, 15_000);
  const nowTs = input.nowTs ?? Date.now();
  return (nowTs - input.latestStateUpdatedAtMs) <= maxAgeMs;
}

export function deriveAppConnectivityState(configured: boolean, activeConnected: boolean): AppConnectivityState {
  if (!configured) {
    return "UNCONFIGURED";
  }
  return activeConnected ? "CONNECTED" : "CONFIGURED_BUT_UNCONNECTED";
}

export function buildInternetSettingsStatusText(input: InternetSettingsStatusInput): string {
  const lastKnownSsid = input.onboardingWifiSsid !== "--" ? input.onboardingWifiSsid : input.wifiSsid.trim();
  if (input.onboardingWifiConnected && lastKnownSsid) {
    return `WLAN ${lastKnownSsid} connected`;
  }
  if (input.onboardingWifiErrorText) {
    return lastKnownSsid ? `WLAN ${lastKnownSsid} failed` : "WLAN connection failed";
  }
  if (input.wifiScanInFlight) {
    return "Scanning WLAN networks...";
  }
  if (input.wifiScanErrorText) {
    return "WLAN scan failed";
  }
  if (lastKnownSsid) {
    return `WLAN ${lastKnownSsid} pending`;
  }
  return "No WLAN configured";
}
