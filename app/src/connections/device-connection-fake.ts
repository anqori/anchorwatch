import type { JsonRecord, PillClass, TrackPoint, WifiScanNetwork } from "../core/types";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { getBoatId } from "../services/persistence-domain";
import { geoDeltaMeters } from "../services/geo-nav";
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
}

const FAKE_HEADING_MAX_RATE_DEG_PER_S = 1;
const ANCHOR_DOWN_HEADING_MAX_OFFSET_DEG = 20;

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

  async sendConfigPatch(_command: ConfigPatchCommand): Promise<void> {
    // No-op in fake mode.
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

    const { snapshot } = this.buildSnapshot();
    const event: DeviceEvent = {
      type: "state.snapshot",
      source: "fake/snapshot",
      boatId: getBoatId() || "boat_demo_001",
      snapshot,
    };

    for (const subscriber of this.eventSubscribers) {
      subscriber(event);
    }
  }

  private buildSnapshot(nowMs = performance.now(), nowTs = Date.now()): { snapshot: JsonRecord; tick: FakeTick } {
    const tick = this.deriveTick(nowMs, nowTs);

    this.points = [...this.points, tick.trackPoint].slice(-1200);

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

    if (depthM < 2.0) {
      return {
        gpsAgeS: ageS,
        dataAgeS: ageS,
        depthM,
        windKn,
        trackPoint: {
          ts: nowTs,
          lat,
          lon,
          sogKn,
          cogDeg,
          headingDeg,
        },
        stateText: "FAKE: ALARM",
        stateClass: "alarm",
      };
    }

    if (windKn > 18.0) {
      return {
        gpsAgeS: ageS,
        dataAgeS: ageS,
        depthM,
        windKn,
        trackPoint: {
          ts: nowTs,
          lat,
          lon,
          sogKn,
          cogDeg,
          headingDeg,
        },
        stateText: "FAKE: WARNING",
        stateClass: "warn",
      };
    }

    return {
      gpsAgeS: ageS,
      dataAgeS: ageS,
      depthM,
      windKn,
      trackPoint: {
        ts: nowTs,
        lat,
        lon,
        sogKn,
        cogDeg,
        headingDeg,
      },
      stateText: "FAKE: MONITORING",
      stateClass: "ok",
    };
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
