import type { AppConnectivityState, InboundSource, LinkLedState } from "../core/types";

export interface InternetSettingsStatusInput {
  onboardingWifiConnected: boolean;
  onboardingWifiSsid: string;
  onboardingWifiErrorText: string;
  wifiSsid: string;
  wifiScanInFlight: boolean;
  wifiScanErrorText: string;
  hasCloudCredentials: boolean;
}

export interface RelayConnectionInput {
  latestStateSource: InboundSource | "--";
  latestStateUpdatedAtMs: number;
  cloudPollMs: number;
  nowTs?: number;
}

export function hasCloudCredentialsConfigured(relayBaseUrl: string, boatId: string, boatSecret: string): boolean {
  return Boolean(relayBaseUrl && boatId && boatSecret);
}

export function hasConfiguredDevice(boatId: string, connectedViaBleOnce: boolean): boolean {
  return boatId.trim().length > 0 && connectedViaBleOnce;
}

export function hasActiveCloudRelayConnection(input: RelayConnectionInput): boolean {
  if (input.latestStateSource !== "cloud/status.snapshot") {
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

export function deriveLinkLedState(
  configured: boolean,
  activeConnected: boolean,
  activeConnection: "fake" | "bluetooth" | "cloud-relay",
): LinkLedState {
  if (!configured) {
    return "unconfigured";
  }
  if (!activeConnected) {
    return "unconnected";
  }
  if (activeConnection === "fake") {
    return "fake";
  }
  if (activeConnection === "bluetooth") {
    return "bt";
  }
  return "relay";
}

export function linkLedTitle(state: LinkLedState): string {
  if (state === "bt") {
    return "Connected via Bluetooth. Open configuration.";
  }
  if (state === "relay") {
    return "Connected via relay. Open configuration.";
  }
  if (state === "fake") {
    return "Demo mode active. Open configuration.";
  }
  if (state === "unconnected") {
    return "Configured but currently unconnected. Open configuration.";
  }
  return "Unconfigured. Open device setup.";
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
  return input.hasCloudCredentials ? "Internet configured, WLAN pending" : "Internet not configured";
}
