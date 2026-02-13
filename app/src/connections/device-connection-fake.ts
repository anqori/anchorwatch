import type { Envelope, InboundSource, JsonRecord, PillClass, TrackPoint } from "../core/types";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { ensurePhoneId, getBoatId } from "../services/persistence-domain";
import type { DeviceConnection, DeviceConnectionProbeResult, DeviceConnectionStatus } from "./device-connection";

interface FakeTick {
  gpsAgeS: number;
  dataAgeS: number;
  depthM: number;
  windKn: number;
  trackPoint: TrackPoint;
  stateText: string;
  stateClass: PillClass;
}

export class DeviceConnectionFake implements DeviceConnection {
  readonly kind = "fake" as const;

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private envelopeSubscribers = new Set<(envelope: Envelope, source: InboundSource) => void>();

  private connected = false;

  private bootMs = performance.now();

  private seq = 1;

  private publishInterval: ReturnType<typeof setInterval> | null = null;

  private points: TrackPoint[] = [];

  async connect(): Promise<void> {
    if (this.connected) {
      this.emitStatus();
      return;
    }

    this.connected = true;
    this.bootMs = performance.now();
    this.seq = 1;
    this.points = [];

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

  subscribeEnvelope(callback: (envelope: Envelope, source: InboundSource) => void): () => void {
    this.envelopeSubscribers.add(callback);
    return () => {
      this.envelopeSubscribers.delete(callback);
    };
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  async sendCommand(_msgType: string, _payload: JsonRecord, _requiresAck?: boolean): Promise<null> {
    return null;
  }

  async sendConfigPatch(_command: ConfigPatchCommand): Promise<void> {
    // No-op in fake mode.
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
    const envelope: Envelope = {
      ver: "am.v1",
      msgType: "status.snapshot",
      msgId: `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      boatId: getBoatId() || "boat_demo_001",
      deviceId: ensurePhoneId(),
      seq: this.seq++,
      ts: Date.now(),
      requiresAck: false,
      payload: {
        snapshot,
      },
    };

    for (const subscriber of this.envelopeSubscribers) {
      subscriber(envelope, "fake/snapshot");
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
    const headingDeg = (cogDeg + Math.sin(t / 7) * 14 + 360) % 360;

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
}
