import { BLE_LIVE_MAX_AGE_MS, CLOUD_HEALTH_POLL_MS, CLOUD_POLL_MS } from "../core/constants";
import type { Envelope, InboundSource, JsonRecord, PillClass } from "../core/types";
import { isObject, parseWifiScanNetworks } from "../services/data-utils";
import { handleDeviceEnvelope } from "../services/device-envelope-handler";
import {
  appState,
  applyStateSnapshot,
  applyStatePatch,
  applyWifiScanNetworks,
  logLine,
  markBleMessageSeen,
  refreshIdentityUi,
  replaceTrackPoints,
  setActiveConnection,
  setActiveConnectionConnected,
  setBleAuthState,
  setBleConnectionState,
  setCloudHealthPollTimestamp,
  setCloudPollTimestamp,
  setSummarySource,
  setSummaryState,
  setTelemetry,
  setBoatId,
  setBoatSecret,
  renderTelemetryFromLatestState,
} from "../state/app-state.svelte";
import type { DeviceConnection, DeviceConnectionStatus } from "../connections/device-connection";
import { defaultConnectionForMode } from "../connections/connection-factory";
import { markConnectedViaBleOnce } from "../services/persistence-domain";

export class DeviceLinker {
  private activeConnection: DeviceConnection;

  private running = false;

  private interval: ReturnType<typeof setInterval> | null = null;

  private lastTickMs = 0;

  private switchingConnection = false;

  private unsubscribeEnvelope: (() => void) | null = null;

  private unsubscribeStatus: (() => void) | null = null;

  constructor(initialConnection: DeviceConnection) {
    this.activeConnection = initialConnection;
  }

  getConnection(): DeviceConnection {
    return this.activeConnection;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.bindConnection(this.activeConnection, false);

    this.interval = setInterval(() => {
      void this.tick();
    }, 250);

    void this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.unsubscribeEnvelope) {
      this.unsubscribeEnvelope();
      this.unsubscribeEnvelope = null;
    }
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }

    await this.activeConnection.disconnect();
  }

  async setConnection(next: DeviceConnection, disconnectPrevious = true): Promise<void> {
    if (next === this.activeConnection) {
      if (!next.isConnected()) {
        await next.connect();
      }
      return;
    }
    await this.bindConnection(next, disconnectPrevious);
  }

  private async bindConnection(next: DeviceConnection, disconnectPrevious: boolean): Promise<void> {
    this.switchingConnection = true;
    try {
      const previous = this.activeConnection;

      if (this.unsubscribeEnvelope) {
        this.unsubscribeEnvelope();
        this.unsubscribeEnvelope = null;
      }
      if (this.unsubscribeStatus) {
        this.unsubscribeStatus();
        this.unsubscribeStatus = null;
      }

      if (disconnectPrevious) {
        await previous.disconnect();
      }

      this.activeConnection = next;
      setActiveConnection(next.kind);

      this.unsubscribeEnvelope = next.subscribeEnvelope((envelope, source) => {
        this.handleEnvelope(envelope, source);
      });

      this.unsubscribeStatus = next.subscribeStatus((status) => {
        void this.handleConnectionStatus(status);
      });

      await next.connect();
    } finally {
      this.switchingConnection = false;
    }
  }

  private async handleConnectionStatus(status: DeviceConnectionStatus): Promise<void> {
    setActiveConnectionConnected(status.connected);

    if (this.activeConnection.kind === "bluetooth") {
      setBleConnectionState(status.connected, status.deviceName || "");
      setBleAuthState(status.authState ?? null);

      if (status.connected) {
        markConnectedViaBleOnce();
        refreshIdentityUi();
      }

      if (!status.connected && !this.switchingConnection && appState.connection.mode === "device") {
        await this.setConnection(defaultConnectionForMode("device"), false);
      }
      return;
    }

    setBleConnectionState(false, "");
    setBleAuthState(null);
  }

  private handleEnvelope(envelope: Envelope, sourceTag: InboundSource): void {
    handleDeviceEnvelope(envelope, sourceTag, {
      setBoatId,
      setBoatSecret,
      applyStatePatch,
      applyStateSnapshot,
      applyWifiScanResult: (payload: JsonRecord) => {
        this.applyWifiScanResult(payload);
      },
      replaceTrackPoints,
      markBleMessageSeen: () => {
        markBleMessageSeen(Date.now());
      },
      logLine,
    });
  }

  private applyWifiScanResult(payload: JsonRecord): void {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const scannedNetworks = parseWifiScanNetworks(payload.networks);

    appState.network.wifiScanInFlight = false;
    appState.network.wifiScanErrorText = "";
    if (requestId) {
      appState.network.wifiScanRequestId = requestId;
    }

    applyWifiScanNetworks(scannedNetworks);
    appState.network.wifiScanStatusText = scannedNetworks.length > 0
      ? `Found ${scannedNetworks.length} WLAN network${scannedNetworks.length === 1 ? "" : "s"}.`
      : "No WLAN networks found. Try scanning again.";
    logLine(`onboarding.wifi.scan_result received (${scannedNetworks.length} networks)`);
  }

  private async tick(): Promise<void> {
    const nowMs = performance.now();
    if (!this.running || nowMs - this.lastTickMs < 1000) {
      return;
    }

    this.lastTickMs = nowMs;
    await this.tickDeviceSummary(nowMs);
  }

  private readFakeSummaryPill(): { text: string; klass: PillClass } {
    const simulation = isObject(appState.latestState.simulation) ? appState.latestState.simulation : {};
    const stateText = typeof simulation.stateText === "string" && simulation.stateText.trim()
      ? simulation.stateText
      : "FAKE: MONITORING";
    const rawClass = typeof simulation.stateClass === "string" ? simulation.stateClass : "";
    const klass: PillClass = rawClass === "alarm" || rawClass === "warn" ? rawClass : "ok";
    return { text: stateText, klass };
  }

  private async tickDeviceSummary(nowMs: number): Promise<void> {
    const nowReal = Date.now();
    if (appState.connection.mode === "fake") {
      await this.pollActiveState(nowReal);
      if (Object.keys(appState.latestState).length > 0) {
        renderTelemetryFromLatestState();
        const fakePill = this.readFakeSummaryPill();
        setSummarySource(appState.latestStateSource || "fake/snapshot");
        setSummaryState(fakePill.text, fakePill.klass);
        return;
      }

      const ageS = Math.floor((nowMs - appState.runtime.bootMs) / 1000);
      setTelemetry(ageS, ageS, 0, 0);
      setSummarySource("fake");
      setSummaryState("FAKE: WAITING DATA", "warn");
      return;
    }

    const bleFresh = appState.ble.connected && (nowReal - appState.runtime.lastBleMessageAtMs) <= BLE_LIVE_MAX_AGE_MS;

    if (bleFresh && Object.keys(appState.latestState).length > 0) {
      renderTelemetryFromLatestState();
      setSummarySource(appState.latestStateSource || "ble/live");
      setSummaryState("DEVICE: BLE LIVE", "ok");
      return;
    }

    await this.pollActiveState(nowReal);

    if (Object.keys(appState.latestState).length > 0) {
      renderTelemetryFromLatestState();
      setSummarySource(appState.latestStateSource || "cloud");
      setSummaryState(appState.ble.connected ? "DEVICE: CLOUD FALLBACK" : "DEVICE: CLOUD", appState.ble.connected ? "warn" : "ok");
      return;
    }

    const ageS = Math.floor((nowMs - appState.runtime.bootMs) / 1000);
    setTelemetry(ageS, ageS, 0, 0);
    setSummarySource("none");
    setSummaryState(appState.ble.connected ? "DEVICE: WAITING DATA" : "DEVICE: NO LINK", "warn");
  }

  private async pollActiveState(nowMs: number): Promise<void> {
    const minPollMs = this.activeConnection.kind === "fake" ? 1000 : CLOUD_POLL_MS;
    if (nowMs - appState.runtime.lastCloudPollMs < minPollMs) {
      return;
    }
    setCloudPollTimestamp(nowMs);

    try {
      if (this.activeConnection.kind === "cloud-relay") {
        await this.refreshCloudVersion(nowMs);
      }

      const snapshot = await this.activeConnection.requestStateSnapshot();
      if (snapshot === null) {
        return;
      }

      if (this.activeConnection.kind === "bluetooth") {
        applyStateSnapshot(snapshot, "ble/snapshot");
        markBleMessageSeen(Date.now());
      } else if (this.activeConnection.kind === "cloud-relay") {
        applyStateSnapshot(snapshot, "cloud/status.snapshot");
      } else {
        applyStateSnapshot(snapshot, "fake/snapshot");
      }
    } catch (error) {
      logLine(`${this.activeConnection.kind} poll failed: ${String(error)}`);
    }
  }

  private async refreshCloudVersion(nowTs: number): Promise<void> {
    if (nowTs - appState.runtime.lastCloudHealthPollMs < CLOUD_HEALTH_POLL_MS) {
      return;
    }

    const base = appState.network.relayBaseUrlInput.trim();
    if (!base) {
      return;
    }

    setCloudHealthPollTimestamp(nowTs);
    try {
      const probeResult = await this.activeConnection.probe(base);
      if (probeResult.buildVersion) {
        appState.versions.cloud = probeResult.buildVersion;
      }
    } catch {
      // Ignore background cloud version errors.
    }
  }
}

export const deviceLinker = new DeviceLinker(defaultConnectionForMode(appState.connection.mode));
