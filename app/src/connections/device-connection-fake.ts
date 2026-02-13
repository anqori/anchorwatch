import type {
  AlertId,
  AlertRuntimeEntry,
  AlertRuntimeState,
  AlertSeverity,
  JsonRecord,
  PillClass,
  TrackPoint,
  WifiScanNetwork,
} from "../core/types";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { getBoatId } from "../services/persistence-domain";
import { geoDeltaMeters } from "../services/geo-nav";
import { isObject, toFiniteNumber } from "../services/data-utils";
import type {
  DeviceConnection,
  DeviceCommandResult,
  DeviceEvent,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
} from "./device-connection";

interface FakeTick {
  gpsAgeS: number;
  dataAgeS: number;
  depthM: number;
  windKn: number;
  trackPoint: TrackPoint;
  stateText: string;
  stateClass: PillClass;
  alerts: AlertRuntimeEntry[];
}

interface FakeAlertConfigCommon {
  isEnabled: boolean;
  minTimeMs: number;
  severity: AlertSeverity;
}

interface FakeAlertsConfig {
  anchor_distance: FakeAlertConfigCommon & { maxDistanceM: number };
  boating_area: FakeAlertConfigCommon & { maxDistanceM: number; polygon: Array<{ lat: number; lon: number }> };
  wind_strength: FakeAlertConfigCommon & { maxTws: number };
  depth: FakeAlertConfigCommon & { minDepth: number };
  data_outdated: FakeAlertConfigCommon & { minAgeMs: number };
}

interface FakeAlertRuntime {
  state: AlertRuntimeState;
  aboveThresholdSinceTs: number | null;
  alertSinceTs: number | null;
  alertSilencedUntilTs: number | null;
}

const FAKE_HEADING_MAX_RATE_DEG_PER_S = 1;
const ANCHOR_DOWN_HEADING_MAX_OFFSET_DEG = 20;
const ALERT_IDS: AlertId[] = ["anchor_distance", "boating_area", "wind_strength", "depth", "data_outdated"];
const ALERT_LABELS: Record<AlertId, string> = {
  anchor_distance: "Anchor Distance",
  boating_area: "Boating Area",
  wind_strength: "Wind Strength",
  depth: "Depth",
  data_outdated: "Data Outdated",
};

function normalizeAngle360(value: number): number {
  return (value % 360 + 360) % 360;
}

function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function moveAngleToward(fromDeg: number, toDeg: number, maxStepDeg: number): number {
  const delta = shortestAngleDelta(fromDeg, toDeg);
  if (Math.abs(delta) <= maxStepDeg) {
    return normalizeAngle360(toDeg);
  }
  return normalizeAngle360(fromDeg + Math.sign(delta) * maxStepDeg);
}

function clampAngleAround(angleDeg: number, centerDeg: number, maxOffsetDeg: number): number {
  const offset = shortestAngleDelta(centerDeg, angleDeg);
  const clampedOffset = Math.max(-maxOffsetDeg, Math.min(maxOffsetDeg, offset));
  return normalizeAngle360(centerDeg + clampedOffset);
}

function defaultFakeAlertsConfig(): FakeAlertsConfig {
  return {
    anchor_distance: {
      isEnabled: true,
      minTimeMs: 15_000,
      severity: "ALARM",
      maxDistanceM: 35,
    },
    boating_area: {
      isEnabled: true,
      minTimeMs: 15_000,
      severity: "ALARM",
      maxDistanceM: 120,
      polygon: [
        { lat: 54.3194, lon: 10.1388 },
        { lat: 54.3212, lon: 10.1388 },
        { lat: 54.3212, lon: 10.1418 },
        { lat: 54.3194, lon: 10.1418 },
      ],
    },
    wind_strength: {
      isEnabled: true,
      minTimeMs: 15_000,
      severity: "WARNING",
      maxTws: 30,
    },
    depth: {
      isEnabled: false,
      minTimeMs: 10_000,
      severity: "ALARM",
      minDepth: 2,
    },
    data_outdated: {
      isEnabled: true,
      minTimeMs: 5_000,
      severity: "WARNING",
      minAgeMs: 5_000,
    },
  };
}

function defaultFakeAlertRuntime(): Record<AlertId, FakeAlertRuntime> {
  return {
    anchor_distance: {
      state: "WATCHING",
      aboveThresholdSinceTs: null,
      alertSinceTs: null,
      alertSilencedUntilTs: null,
    },
    boating_area: {
      state: "WATCHING",
      aboveThresholdSinceTs: null,
      alertSinceTs: null,
      alertSilencedUntilTs: null,
    },
    wind_strength: {
      state: "WATCHING",
      aboveThresholdSinceTs: null,
      alertSinceTs: null,
      alertSilencedUntilTs: null,
    },
    depth: {
      state: "WATCHING",
      aboveThresholdSinceTs: null,
      alertSinceTs: null,
      alertSilencedUntilTs: null,
    },
    data_outdated: {
      state: "WATCHING",
      aboveThresholdSinceTs: null,
      alertSinceTs: null,
      alertSilencedUntilTs: null,
    },
  };
}

function alertSeverityFromPatch(value: unknown, fallback: AlertSeverity): AlertSeverity {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "ALARM") {
    return "ALARM";
  }
  if (raw === "WARNING") {
    return "WARNING";
  }
  return fallback;
}

function lookupPatchValue(patch: JsonRecord, dottedPath: string): unknown {
  if (Object.prototype.hasOwnProperty.call(patch, dottedPath)) {
    return patch[dottedPath];
  }

  const parts = dottedPath.split(".");
  let cursor: unknown = patch;
  for (const part of parts) {
    if (!isObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

export class DeviceConnectionFake implements DeviceConnection {
  readonly kind = "fake" as const;

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private eventSubscribers = new Set<(event: DeviceEvent) => void>();

  private connected = false;

  private bootMs = performance.now();

  private publishInterval: ReturnType<typeof setInterval> | null = null;

  private points: TrackPoint[] = [];

  private anchorState: "up" | "down" | "auto-pending" = "up";

  private anchorLat: number | null = null;

  private anchorLon: number | null = null;

  private simulatedHeadingDeg = 0;

  private lastHeadingUpdateMs = 0;

  private alertsConfig: FakeAlertsConfig = defaultFakeAlertsConfig();

  private alertRuntime: Record<AlertId, FakeAlertRuntime> = defaultFakeAlertRuntime();

  async connect(): Promise<void> {
    if (this.connected) {
      this.emitStatus();
      return;
    }

    this.connected = true;
    this.bootMs = performance.now();
    this.points = [];
    this.anchorState = "up";
    this.anchorLat = null;
    this.anchorLon = null;
    this.simulatedHeadingDeg = 0;
    this.lastHeadingUpdateMs = 0;
    this.alertRuntime = defaultFakeAlertRuntime();

    this.publishInterval = setInterval(() => {
      this.publishSnapshot();
    }, 1000);

    this.publishSnapshot();
    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
    }
    this.emitStatus();
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeEvents(callback: (event: DeviceEvent) => void): () => void {
    this.eventSubscribers.add(callback);
    return () => {
      this.eventSubscribers.delete(callback);
    };
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
    const patch = command.patch;

    this.alertsConfig.anchor_distance.isEnabled = lookupPatchValue(patch, "alerts.anchor_distance.is_enabled") === true
      ? true
      : lookupPatchValue(patch, "alerts.anchor_distance.is_enabled") === false
        ? false
        : this.alertsConfig.anchor_distance.isEnabled;
    this.alertsConfig.anchor_distance.minTimeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.anchor_distance.min_time_ms")) ?? this.alertsConfig.anchor_distance.minTimeMs);
    this.alertsConfig.anchor_distance.severity = alertSeverityFromPatch(
      lookupPatchValue(patch, "alerts.anchor_distance.severity"),
      this.alertsConfig.anchor_distance.severity,
    );
    this.alertsConfig.anchor_distance.maxDistanceM = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.anchor_distance.max_distance_m")) ?? this.alertsConfig.anchor_distance.maxDistanceM);

    this.alertsConfig.boating_area.isEnabled = lookupPatchValue(patch, "alerts.boating_area.is_enabled") === true
      ? true
      : lookupPatchValue(patch, "alerts.boating_area.is_enabled") === false
        ? false
        : this.alertsConfig.boating_area.isEnabled;
    this.alertsConfig.boating_area.minTimeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.boating_area.min_time_ms")) ?? this.alertsConfig.boating_area.minTimeMs);
    this.alertsConfig.boating_area.severity = alertSeverityFromPatch(
      lookupPatchValue(patch, "alerts.boating_area.severity"),
      this.alertsConfig.boating_area.severity,
    );
    const boatingPolygon = lookupPatchValue(patch, "alerts.boating_area.polygon");
    if (Array.isArray(boatingPolygon)) {
      const polygonPoints: Array<{ lat: number; lon: number }> = [];
      for (const point of boatingPolygon) {
        if (!isObject(point)) {
          continue;
        }
        const lat = toFiniteNumber(point.lat);
        const lon = toFiniteNumber(point.lon);
        if (lat !== null && lon !== null) {
          polygonPoints.push({ lat, lon });
        }
      }
      if (polygonPoints.length >= 3) {
        this.alertsConfig.boating_area.polygon = polygonPoints;
      }
    }

    this.alertsConfig.wind_strength.isEnabled = lookupPatchValue(patch, "alerts.wind_strength.is_enabled") === true
      ? true
      : lookupPatchValue(patch, "alerts.wind_strength.is_enabled") === false
        ? false
        : this.alertsConfig.wind_strength.isEnabled;
    this.alertsConfig.wind_strength.minTimeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.wind_strength.min_time_ms")) ?? this.alertsConfig.wind_strength.minTimeMs);
    this.alertsConfig.wind_strength.severity = alertSeverityFromPatch(
      lookupPatchValue(patch, "alerts.wind_strength.severity"),
      this.alertsConfig.wind_strength.severity,
    );
    this.alertsConfig.wind_strength.maxTws = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.wind_strength.max_tws")) ?? this.alertsConfig.wind_strength.maxTws);

    this.alertsConfig.depth.isEnabled = lookupPatchValue(patch, "alerts.depth.is_enabled") === true
      ? true
      : lookupPatchValue(patch, "alerts.depth.is_enabled") === false
        ? false
        : this.alertsConfig.depth.isEnabled;
    this.alertsConfig.depth.minTimeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.depth.min_time_ms")) ?? this.alertsConfig.depth.minTimeMs);
    this.alertsConfig.depth.severity = alertSeverityFromPatch(
      lookupPatchValue(patch, "alerts.depth.severity"),
      this.alertsConfig.depth.severity,
    );
    this.alertsConfig.depth.minDepth = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.depth.min_depth")) ?? this.alertsConfig.depth.minDepth);

    this.alertsConfig.data_outdated.isEnabled = lookupPatchValue(patch, "alerts.data_outdated.is_enabled") === true
      ? true
      : lookupPatchValue(patch, "alerts.data_outdated.is_enabled") === false
        ? false
        : this.alertsConfig.data_outdated.isEnabled;
    this.alertsConfig.data_outdated.minTimeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.data_outdated.min_time_ms")) ?? this.alertsConfig.data_outdated.minTimeMs);
    this.alertsConfig.data_outdated.severity = alertSeverityFromPatch(
      lookupPatchValue(patch, "alerts.data_outdated.severity"),
      this.alertsConfig.data_outdated.severity,
    );
    this.alertsConfig.data_outdated.minAgeMs = Math.max(0, toFiniteNumber(lookupPatchValue(patch, "alerts.data_outdated.min_age")) ?? this.alertsConfig.data_outdated.minAgeMs);

    this.publishSnapshot();
  }

  async commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]> {
    const networks: WifiScanNetwork[] = [
      { ssid: "Demo Marina", security: "wpa2", rssi: -52, channel: 1, hidden: false },
      { ssid: "Dockside Guest", security: "open", rssi: -64, channel: 6, hidden: false },
      { ssid: "AnchorMaster Lab", security: "wpa3", rssi: -71, channel: 11, hidden: false },
    ];
    const hiddenNetwork: WifiScanNetwork = { ssid: "", security: "wpa2", rssi: -80, channel: 3, hidden: true };
    const resultNetworks = includeHidden
      ? [...networks, hiddenNetwork]
      : [...networks];
    return resultNetworks.slice(0, Math.max(0, maxResults));
  }

  async commandAnchorRise(): Promise<DeviceCommandResult> {
    this.anchorState = "up";
    this.points = [];
    this.publishSnapshot();
    return {
      accepted: true,
      status: "ok",
      errorCode: null,
      errorDetail: null,
    };
  }

  async commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult> {
    const wasAnchorUp = this.anchorState === "up";
    this.anchorState = "down";
    this.anchorLat = Number.isFinite(lat) ? lat : null;
    this.anchorLon = Number.isFinite(lon) ? lon : null;
    if (wasAnchorUp) {
      this.points = [];
    }
    this.publishSnapshot();
    return {
      accepted: true,
      status: "ok",
      errorCode: null,
      errorDetail: null,
    };
  }

  async commandAlarmSilence(seconds: number): Promise<DeviceCommandResult> {
    const nowTs = Date.now();
    const silenceMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.floor(seconds * 1000)));
    const silenceUntilTs = nowTs + silenceMs;

    for (const id of ALERT_IDS) {
      const runtime = this.alertRuntime[id];
      if (runtime.state === "TRIGGERED" || runtime.state === "ALERT" || runtime.state === "ALERT_SILENCED") {
        runtime.alertSilencedUntilTs = silenceUntilTs;
        if (runtime.alertSinceTs === null) {
          runtime.alertSinceTs = nowTs;
        }
        runtime.state = "ALERT_SILENCED";
      }
    }

    this.publishSnapshot();
    return {
      accepted: true,
      status: "ok",
      errorCode: null,
      errorDetail: null,
    };
  }

  async requestStateSnapshot(): Promise<JsonRecord | null> {
    return this.buildSnapshot().snapshot;
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    if (limit <= 0) {
      return [];
    }
    return this.points.slice(-limit);
  }

  async probe(): Promise<DeviceConnectionProbeResult> {
    return {
      ok: true,
      resultText: "Fake device available",
      buildVersion: null,
    };
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.connected,
      deviceName: "demo-device",
      authState: {
        sessionPaired: true,
        pairModeActive: false,
      },
    };
  }

  private emitStatus(): void {
    const status = this.currentStatus();
    for (const subscriber of this.statusSubscribers) {
      subscriber(status);
    }
  }

  private publishSnapshot(): void {
    if (!this.connected) {
      return;
    }

    const { snapshot, tick } = this.buildSnapshot();
    const boatId = getBoatId() || "boat_demo_001";

    const alertsEvent: DeviceEvent = {
      type: "alerts.state",
      source: "fake/snapshot",
      boatId,
      alerts: tick.alerts,
    };

    const snapshotEvent: DeviceEvent = {
      type: "state.snapshot",
      source: "fake/snapshot",
      boatId,
      snapshot,
    };

    for (const subscriber of this.eventSubscribers) {
      subscriber(alertsEvent);
      subscriber(snapshotEvent);
    }
  }

  private buildSnapshot(nowMs = performance.now(), nowTs = Date.now()): { snapshot: JsonRecord; tick: FakeTick } {
    const tick = this.deriveTick(nowMs, nowTs);

    this.points = [...this.points, tick.trackPoint].slice(-1200);

    const alertsObject: JsonRecord = {};
    for (const alert of tick.alerts) {
      alertsObject[alert.id] = {
        state: alert.state,
        severity: alert.severity,
        above_threshold_since_ts: alert.aboveThresholdSinceTs,
        alert_since_ts: alert.alertSinceTs,
        alert_silenced_until_ts: alert.alertSilencedUntilTs,
      };
    }

    const snapshot: JsonRecord = {
      telemetry: {
        gps: {
          lat: tick.trackPoint.lat,
          lon: tick.trackPoint.lon,
          ageMs: tick.gpsAgeS * 1000,
          sogKn: tick.trackPoint.sogKn,
          cogDeg: tick.trackPoint.cogDeg,
          headingDeg: tick.trackPoint.headingDeg,
          valid: true,
        },
        motion: {
          sogKn: tick.trackPoint.sogKn,
          cogDeg: tick.trackPoint.cogDeg,
          headingDeg: tick.trackPoint.headingDeg,
        },
        depth: {
          meters: tick.depthM,
          ageMs: tick.dataAgeS * 1000,
        },
        wind: {
          knots: tick.windKn,
          ageMs: tick.dataAgeS * 1000,
        },
      },
      simulation: {
        stateText: tick.stateText,
        stateClass: tick.stateClass,
      },
      anchor: {
        state: this.anchorState,
        position: this.anchorLat === null || this.anchorLon === null
          ? null
          : {
            lat: this.anchorLat,
            lon: this.anchorLon,
          },
      },
      alerts: alertsObject,
    };

    return { snapshot, tick };
  }

  private deriveTick(nowMs: number, nowTs: number): FakeTick {
    const ageMs = Math.floor(nowMs - this.bootMs);
    const depthM = 3.2 + Math.sin(ageMs / 9000) * 0.35;
    const windKn = 12.0 + Math.sin(ageMs / 5000) * 2.5;
    const ageS = Math.floor(ageMs / 1000);
    const t = ageMs / 1000;
    const lat = 54.3201 + Math.sin(t / 45) * 0.0007;
    const lon = 10.1402 + Math.cos(t / 60) * 0.0011;
    const sogKn = 0.4 + Math.abs(Math.sin(t / 10)) * 0.8;
    const cogDeg = (t * 16) % 360;
    const headingTargetDeg = normalizeAngle360(cogDeg + Math.sin(t / 9) * 10);
    const anchorBearingDeg = this.readAnchorBearingDeg(lat, lon);
    const headingDeg = this.computeSimulatedHeading(nowMs, headingTargetDeg, anchorBearingDeg);

    const trackPoint: TrackPoint = {
      ts: nowTs,
      lat,
      lon,
      sogKn,
      cogDeg,
      headingDeg,
    };

    const alerts = this.evaluateAlerts(nowTs, lat, lon, depthM, windKn, ageS * 1000, ageS * 1000, ageS * 1000);

    const hasAlarm = alerts.some((alert) => alert.state === "ALERT");
    const hasTriggered = alerts.some((alert) => alert.state === "TRIGGERED" || alert.state === "ALERT_SILENCED");

    if (hasAlarm) {
      return {
        gpsAgeS: ageS,
        dataAgeS: ageS,
        depthM,
        windKn,
        trackPoint,
        stateText: "FAKE: ALERT",
        stateClass: "alarm",
        alerts,
      };
    }

    if (hasTriggered) {
      return {
        gpsAgeS: ageS,
        dataAgeS: ageS,
        depthM,
        windKn,
        trackPoint,
        stateText: "FAKE: WARNING",
        stateClass: "warn",
        alerts,
      };
    }

    return {
      gpsAgeS: ageS,
      dataAgeS: ageS,
      depthM,
      windKn,
      trackPoint,
      stateText: "FAKE: MONITORING",
      stateClass: "ok",
      alerts,
    };
  }

  private evaluateAlerts(
    nowTs: number,
    boatLat: number,
    boatLon: number,
    depthM: number,
    windKn: number,
    gpsAgeMs: number,
    windAgeMs: number,
    depthAgeMs: number,
  ): AlertRuntimeEntry[] {
    const anchorDistance = this.readDistanceToAnchorM(boatLat, boatLon);

    const anchorDistanceOverThreshold = anchorDistance !== null
      && anchorDistance > this.alertsConfig.anchor_distance.maxDistanceM;
    const boatingAreaOutside = anchorDistance !== null
      && anchorDistance > this.alertsConfig.boating_area.maxDistanceM;

    const dataAgeCandidates: number[] = [gpsAgeMs];
    if (this.alertsConfig.wind_strength.isEnabled) {
      dataAgeCandidates.push(windAgeMs);
    }
    if (this.alertsConfig.depth.isEnabled) {
      dataAgeCandidates.push(depthAgeMs);
    }
    const maxRelevantAgeMs = Math.max(...dataAgeCandidates);

    return [
      this.updateAlert("anchor_distance", anchorDistanceOverThreshold, nowTs),
      this.updateAlert("boating_area", boatingAreaOutside, nowTs),
      this.updateAlert("wind_strength", windKn > this.alertsConfig.wind_strength.maxTws, nowTs),
      this.updateAlert("depth", depthM < this.alertsConfig.depth.minDepth, nowTs),
      this.updateAlert("data_outdated", maxRelevantAgeMs > this.alertsConfig.data_outdated.minAgeMs, nowTs),
    ];
  }

  private updateAlert(id: AlertId, aboveThreshold: boolean, nowTs: number): AlertRuntimeEntry {
    const runtime = this.alertRuntime[id];
    const config = this.alertsConfig[id];

    if (runtime.alertSilencedUntilTs !== null && runtime.alertSilencedUntilTs <= nowTs) {
      runtime.alertSilencedUntilTs = null;
    }

    if (!config.isEnabled) {
      runtime.state = "DISABLED";
      runtime.aboveThresholdSinceTs = null;
      runtime.alertSinceTs = null;
      runtime.alertSilencedUntilTs = null;
      return this.toAlertEntry(id);
    }

    if (!aboveThreshold) {
      runtime.state = "WATCHING";
      runtime.aboveThresholdSinceTs = null;
      runtime.alertSinceTs = null;
      return this.toAlertEntry(id);
    }

    if (runtime.aboveThresholdSinceTs === null) {
      runtime.aboveThresholdSinceTs = nowTs;
    }

    if (nowTs - runtime.aboveThresholdSinceTs < config.minTimeMs) {
      runtime.state = "WATCHING";
      return this.toAlertEntry(id);
    }

    if (runtime.alertSinceTs === null) {
      runtime.alertSinceTs = nowTs;
      runtime.state = "TRIGGERED";
      return this.toAlertEntry(id);
    }

    if (runtime.alertSilencedUntilTs !== null && runtime.alertSilencedUntilTs > nowTs) {
      runtime.state = "ALERT_SILENCED";
      return this.toAlertEntry(id);
    }

    runtime.state = "ALERT";
    return this.toAlertEntry(id);
  }

  private toAlertEntry(id: AlertId): AlertRuntimeEntry {
    const runtime = this.alertRuntime[id];
    const config = this.alertsConfig[id];
    return {
      id,
      label: ALERT_LABELS[id],
      severity: config.severity,
      state: runtime.state,
      aboveThresholdSinceTs: runtime.aboveThresholdSinceTs,
      alertSinceTs: runtime.alertSinceTs,
      alertSilencedUntilTs: runtime.alertSilencedUntilTs,
    };
  }

  private readDistanceToAnchorM(lat: number, lon: number): number | null {
    if (this.anchorState !== "down" || this.anchorLat === null || this.anchorLon === null) {
      return null;
    }
    return geoDeltaMeters(
      { lat: this.anchorLat, lon: this.anchorLon },
      { lat, lon },
    ).distanceM;
  }

  private readAnchorBearingDeg(lat: number, lon: number): number | null {
    if (this.anchorState !== "down" || this.anchorLat === null || this.anchorLon === null) {
      return null;
    }
    return geoDeltaMeters(
      { lat: this.anchorLat, lon: this.anchorLon },
      { lat, lon },
    ).bearingDeg;
  }

  private computeSimulatedHeading(nowMs: number, targetDeg: number, anchorBearingDeg: number | null): number {
    const normalizedTarget = normalizeAngle360(targetDeg);
    if (this.lastHeadingUpdateMs <= 0) {
      this.simulatedHeadingDeg = normalizedTarget;
      this.lastHeadingUpdateMs = nowMs;
    }

    const elapsedS = Math.max(0, (nowMs - this.lastHeadingUpdateMs) / 1000);
    this.lastHeadingUpdateMs = nowMs;

    const maxStepDeg = FAKE_HEADING_MAX_RATE_DEG_PER_S * elapsedS;
    let headingDeg = moveAngleToward(this.simulatedHeadingDeg, normalizedTarget, maxStepDeg);

    if (anchorBearingDeg !== null) {
      headingDeg = clampAngleAround(headingDeg, anchorBearingDeg, ANCHOR_DOWN_HEADING_MAX_OFFSET_DEG);
    }

    this.simulatedHeadingDeg = headingDeg;
    return headingDeg;
  }
}
