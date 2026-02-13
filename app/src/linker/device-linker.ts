import { TRACK_SNAPSHOT_LIMIT } from "../core/constants";
import type { PillClass } from "../core/types";
import { isObject } from "../services/data-utils";
import {
  appState,
  applyStateSnapshot,
  applyStatePatch,
  logLine,
  markBleMessageSeen,
  refreshIdentityUi,
  replaceTrackPoints,
  setActiveConnection,
  setActiveConnectionConnected,
  setBleAuthState,
  setBleConnectionState,
  setSummarySource,
  setSummaryState,
  setTelemetry,
  setBoatId,
  setBoatSecret,
  renderTelemetryFromLatestState,
} from "../state/app-state.svelte";
import type { DeviceConnection, DeviceConnectionStatus, DeviceEvent } from "../connections/device-connection";
import { defaultConnectionForMode } from "../connections/connection-factory";
import { markConnectedViaBleOnce } from "../services/persistence-domain";

export class DeviceLinker {
  private activeConnection: DeviceConnection;

  private running = false;

  private interval: ReturnType<typeof setInterval> | null = null;

  private lastTickMs = 0;

  private switchingConnection = false;

  private unsubscribeEvents: (() => void) | null = null;

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

    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
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

      if (this.unsubscribeEvents) {
        this.unsubscribeEvents();
        this.unsubscribeEvents = null;
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

      this.unsubscribeEvents = next.subscribeEvents((event) => {
        this.handleEvent(event);
      });

      this.unsubscribeStatus = next.subscribeStatus((status) => {
        void this.handleConnectionStatus(status);
      });

      await next.connect();
      void this.primeConnection(next);
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

  private handleEvent(event: DeviceEvent): void {
    if (event.boatId) {
      setBoatId(event.boatId);
    }

    if (event.type === "state.patch") {
      applyStatePatch(event.patch, event.source);
      renderTelemetryFromLatestState();
      if (event.source === "ble/eventRx" || event.source === "ble/snapshot") {
        markBleMessageSeen(Date.now());
      }
      return;
    }

    if (event.type === "state.snapshot") {
      applyStateSnapshot(event.snapshot, event.source);
      renderTelemetryFromLatestState();
      if (event.source === "ble/eventRx" || event.source === "ble/snapshot") {
        markBleMessageSeen(Date.now());
      }
      return;
    }

    if (event.type === "onboarding.boatSecret") {
      if (event.onboardingBoatId) {
        setBoatId(event.onboardingBoatId);
      }
      if (event.boatSecret && event.boatSecret.trim()) {
        setBoatSecret(event.boatSecret);
        logLine("received onboarding.boat_secret and stored secret");
      } else {
        logLine("onboarding.boat_secret missing boatSecret");
      }
      return;
    }

    if (event.type === "track.snapshot") {
      if (event.points.length > 0) {
        replaceTrackPoints(event.points);
        logLine(`track.snapshot received (${event.points.length} points)`);
      } else {
        logLine("track.snapshot received (no valid points)");
      }
      return;
    }

    if (event.type === "alerts.state") {
      const alertsPatch: Record<string, unknown> = {};
      for (const alert of event.alerts) {
        alertsPatch[alert.id] = {
          state: alert.state,
          severity: alert.severity,
          above_threshold_since_ts: alert.aboveThresholdSinceTs,
          alert_since_ts: alert.alertSinceTs,
          alert_silenced_until_ts: alert.alertSilencedUntilTs,
        };
      }
      applyStatePatch({ alerts: alertsPatch }, event.source);
      if (event.source === "ble/eventRx" || event.source === "ble/snapshot") {
        markBleMessageSeen(Date.now());
      }
      return;
    }

    if (event.type === "unknown") {
      logLine(`rx ${event.msgType} (${event.source})`);
    }
  }

  private async primeConnection(connection: DeviceConnection): Promise<void> {
    if (!connection.isConnected()) {
      return;
    }

    try {
      await connection.requestStateSnapshot();
    } catch (error) {
      logLine(`${connection.kind} initial status.snapshot failed: ${String(error)}`);
    }

    try {
      await connection.requestTrackSnapshot(TRACK_SNAPSHOT_LIMIT);
    } catch (error) {
      logLine(`${connection.kind} initial track.snapshot failed: ${String(error)}`);
    }
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
    if (Object.keys(appState.latestState).length > 0) {
      renderTelemetryFromLatestState();
      if (appState.connection.mode === "fake") {
        const fakePill = this.readFakeSummaryPill();
        setSummarySource(appState.latestStateSource || "fake/snapshot");
        setSummaryState(fakePill.text, fakePill.klass);
        return;
      }
      setSummarySource(appState.latestStateSource || "device/live");
      setSummaryState(this.activeConnection.isConnected() ? "DEVICE: LIVE" : "DEVICE: STALE DATA", this.activeConnection.isConnected() ? "ok" : "warn");
      return;
    }

    const ageS = Math.floor((nowMs - appState.runtime.bootMs) / 1000);
    setTelemetry(ageS, ageS, 0, 0);
    if (appState.connection.mode === "fake") {
      setSummarySource("fake");
      setSummaryState("FAKE: WAITING DATA", "warn");
      return;
    }
    setSummarySource("none");
    setSummaryState(this.activeConnection.isConnected() ? "DEVICE: WAITING DATA" : "DEVICE: NO LINK", "warn");
  }
}

export const deviceLinker = new DeviceLinker(defaultConnectionForMode(appState.connection.mode));
