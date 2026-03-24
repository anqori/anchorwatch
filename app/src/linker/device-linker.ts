import {
  appState,
  logLine,
  markBleMessageSeen,
  refreshDerivedDeviceState,
  refreshIdentityUi,
  replaceTrackPoints,
  setActiveConnection,
  setActiveConnectionConnected,
  setAlarmConfig,
  setAnchorSettingsConfig,
  setBleAuthState,
  setBleConnectionState,
  setCloudConfig,
  setLatestInbound,
  setObstaclesConfig,
  setProfilesConfig,
  setSummarySource,
  setSummaryState,
  setSystemConfig,
  setTelemetry,
  setWlanConfig,
  setBoatId,
  setCloudSecret,
  showErrorToast,
} from "../state/app-state.svelte";
import type {
  DeviceConnection,
  DeviceConnectionStatus,
  DeviceStreamHandle,
  DeviceStreamMessage,
} from "../connections/device-connection";
import type { DeviceConnectionBleLike } from "../connections/ble/device-connection-ble-like";
import { defaultConnectionForRuntimeMode } from "../connections/connection-factory";
import { getBleConnectionPin, markConnectedViaBleOnce } from "../services/persistence-domain";
import {
  readAlarmConfigValue,
  readAlarmStateValue,
  readAnchorPositionValue,
  readAnchorSettingsValue,
  readCloudConfigValue,
  readDepthValue,
  readObstaclesConfigValue,
  readPositionValue,
  readProfilesConfigValue,
  readSystemConfigValue,
  readSystemStatusValue,
  readTrackBackfill,
  readWlanConfigValue,
  readWlanStatusValue,
  readWindValue,
} from "../services/protocol-v2-state";

export class DeviceLinker {
  private activeConnection: DeviceConnection;

  private running = false;

  private interval: ReturnType<typeof setInterval> | null = null;

  private switchingConnection = false;

  private unsubscribeStatus: (() => void) | null = null;

  private boundConnection: DeviceConnection | null = null;

  private getDataHandle: DeviceStreamHandle | null = null;

  private getDataConnection: DeviceConnection | null = null;

  private getDataStartPromise: Promise<void> | null = null;

  private getDataStartConnection: DeviceConnection | null = null;

  private authorizePromise: Promise<void> | null = null;

  private authorizeConnection: DeviceConnection | null = null;

  private cloudAuthorizedConnection: DeviceConnection | null = null;

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
      this.tickDeviceSummary();
    }, 1000);
    this.tickDeviceSummary();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await this.stopGetDataStream();
    this.clearSubscriptions();
    await this.activeConnection.disconnect();
  }

  async setConnection(next: DeviceConnection, disconnectPrevious = true): Promise<void> {
    await this.bindConnection(next, disconnectPrevious);
  }

  async request(type: Parameters<DeviceConnection["request"]>[0], data?: unknown) {
    return await this.activeConnection.request(type, data);
  }

  async ensureRuntimeStream(): Promise<void> {
    await this.ensureAuthorizedAndGetData(this.activeConnection);
  }

  async restartRuntimeStream(): Promise<void> {
    await this.stopGetDataStream();
    await this.ensureAuthorizedAndGetData(this.activeConnection);
  }

  private async bindConnection(next: DeviceConnection, disconnectPrevious: boolean): Promise<void> {
    this.switchingConnection = true;
    try {
      const previous = this.activeConnection;
      const switchedConnection = previous !== next;

      if (switchedConnection) {
        await this.stopGetDataStream();
        this.clearSubscriptions();
        if (disconnectPrevious) {
          await previous.disconnect();
        }
        this.activeConnection = next;
        setActiveConnection(next.kind);
      }

      this.bindSubscriptions(next);

      if (!next.isConnected()) {
        await next.connect();
      }

      if (next.isConnected()) {
        await this.ensureAuthorizedAndGetData(next);
      }
    } finally {
      this.switchingConnection = false;
    }
  }

  private clearSubscriptions(): void {
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }
    this.boundConnection = null;
  }

  private bindSubscriptions(connection: DeviceConnection): void {
    if (this.boundConnection === connection && this.unsubscribeStatus) {
      return;
    }
    this.clearSubscriptions();
    this.boundConnection = connection;
    this.unsubscribeStatus = connection.subscribeStatus((status) => {
      if (this.boundConnection !== connection || this.activeConnection !== connection) {
        return;
      }
      void this.handleConnectionStatus(connection, status);
    });
  }

  private async handleConnectionStatus(connection: DeviceConnection, status: DeviceConnectionStatus): Promise<void> {
    setActiveConnectionConnected(status.connected);

    if (connection.kind === "bluetooth") {
      setBleConnectionState(status.connected, status.deviceName || "", status.phase ?? (status.connected ? "connected" : "disconnected"));
      setBleAuthState(status.authState ?? null);
      if (status.connected) {
        markConnectedViaBleOnce();
        markBleMessageSeen(Date.now());
        refreshIdentityUi();
      }
    } else {
      setBleConnectionState(false, "", "disconnected");
      setBleAuthState(null);
    }

    if (!status.connected) {
      if (this.getDataConnection === connection) {
        this.getDataConnection = null;
        this.getDataHandle = null;
      }
      if (this.cloudAuthorizedConnection === connection) {
        this.cloudAuthorizedConnection = null;
      }
      return;
    }

    try {
      await this.ensureAuthorizedAndGetData(connection, status);
    } catch (error) {
      logLine(`connection authorization failed: ${String(error)}`);
      showErrorToast(error instanceof Error ? error.message : String(error));
    }
  }

  private async ensureAuthorizedAndGetData(connection: DeviceConnection, status?: DeviceConnectionStatus): Promise<void> {
    if (connection.kind === "bluetooth") {
      const authState = (status?.authState ?? appState.ble.authState) as Record<string, unknown> | null;
      const boatAccessState = typeof authState?.boat_access_state === "string" ? authState.boat_access_state : "";
      const sessionState = typeof authState?.session_state === "string" ? authState.session_state : "";
      if (boatAccessState === "SETUP_REQUIRED") {
        return;
      }
      if (sessionState !== "AUTHORIZED") {
        await this.ensureAuthorizedSession(connection);
        return;
      }
      await this.ensureGetDataStream(connection);
      return;
    }

    await this.ensureGetDataStream(connection);
  }

  private async ensureAuthorizedSession(connection: DeviceConnection): Promise<void> {
    if (connection.kind !== "bluetooth") {
      this.cloudAuthorizedConnection = connection;
      return;
    }

    const bleConnectionPin = getBleConnectionPin().trim();
    if (!bleConnectionPin) {
      return;
    }
    if (this.authorizePromise && this.authorizeConnection === connection) {
      await this.authorizePromise;
      return;
    }

    const run = async (): Promise<void> => {
      const startedAt = performance.now();
      await connection.request("AUTHORIZE_BLE_SESSION", {
        ble_connection_pin: bleConnectionPin,
      });
      logLine(`session authorize: ACK via ${connection.kind} (+${Math.round(performance.now() - startedAt)}ms)`);
      const bleConnection = connection as DeviceConnectionBleLike;
      const authReadStartedAt = performance.now();
      const authState = await bleConnection.refreshAuthState();
      logLine(`session authorize: auth refresh done (+${Math.round(performance.now() - authReadStartedAt)}ms, total ${Math.round(performance.now() - startedAt)}ms)`);
      setBleAuthState(authState);
      if (connection.isConnected()) {
        await this.ensureGetDataStream(connection);
      }
    };

    this.authorizePromise = run().finally(() => {
      if (this.authorizeConnection === connection) {
        this.authorizePromise = null;
        this.authorizeConnection = null;
      }
    });
    this.authorizeConnection = connection;
    await this.authorizePromise;
  }

  private async ensureGetDataStream(connection: DeviceConnection): Promise<void> {
    if (this.getDataHandle && this.getDataConnection === connection) {
      return;
    }

    if (this.getDataStartPromise && this.getDataStartConnection === connection) {
      await this.getDataStartPromise;
      return;
    }

    const startPromise = this.startGetDataStream(connection);
    this.getDataStartPromise = startPromise;
    this.getDataStartConnection = connection;
    try {
      await startPromise;
    } finally {
      if (this.getDataStartPromise === startPromise) {
        this.getDataStartPromise = null;
        this.getDataStartConnection = null;
      }
    }
  }

  private async stopGetDataStream(): Promise<void> {
    const handle = this.getDataHandle;
    this.getDataHandle = null;
    this.getDataConnection = null;
    if (!handle) {
      return;
    }
    try {
      await handle.cancel();
    } catch {
      // ignore
    }
  }

  private async startGetDataStream(connection: DeviceConnection): Promise<void> {
    await this.stopGetDataStream();
    if (!connection.isConnected()) {
      return;
    }

    const startedAt = performance.now();
    const handle = await connection.openStream("GET_DATA", {}, (message) => {
      this.handleGetDataReply(connection, message);
    });
    logLine(`GET_DATA stream opened via ${connection.kind} (+${Math.round(performance.now() - startedAt)}ms)`);
    this.getDataHandle = handle;
    this.getDataConnection = connection;

    void handle.done.catch((error) => {
      if (this.getDataHandle === handle) {
        this.getDataHandle = null;
        this.getDataConnection = null;
      }
      logLine(`GET_DATA stream ended: ${String(error)}`);
      showErrorToast(`GET_DATA failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private handleGetDataReply(connection: DeviceConnection, message: DeviceStreamMessage): void {
    if (this.activeConnection !== connection) {
      return;
    }

    setLatestInbound(message.source);
    if (message.source === "ble/eventRx") {
      markBleMessageSeen(Date.now());
    }

    switch (message.reply.type) {
      case "STATE_POSITION": {
        const value = readPositionValue(message.reply.data);
        if (value) {
          appState.deviceData.position = value;
        }
        break;
      }
      case "STATE_DEPTH": {
        const value = readDepthValue(message.reply.data);
        if (value) {
          appState.deviceData.depth = value;
        }
        break;
      }
      case "STATE_WIND": {
        const value = readWindValue(message.reply.data);
        if (value) {
          appState.deviceData.wind = value;
        }
        break;
      }
      case "STATE_WLAN_STATUS": {
        const value = readWlanStatusValue(message.reply.data);
        if (value) {
          appState.deviceData.wlanStatus = value;
        }
        break;
      }
      case "STATE_SYSTEM_STATUS": {
        const value = readSystemStatusValue(message.reply.data);
        if (value) {
          appState.deviceData.systemStatus = value;
        }
        break;
      }
      case "STATE_ANCHOR_POSITION": {
        const value = readAnchorPositionValue(message.reply.data);
        if (value) {
          appState.deviceData.anchorPosition = value;
        }
        break;
      }
      case "STATE_ALARM_STATE": {
        const value = readAlarmStateValue(message.reply.data);
        if (value) {
          appState.deviceData.alarmState = value;
        }
        break;
      }
      case "CONFIG_ALARM": {
        const value = readAlarmConfigValue(message.reply.data);
        if (value) {
          setAlarmConfig(value);
        }
        break;
      }
      case "CONFIG_OBSTACLES": {
        const value = readObstaclesConfigValue(message.reply.data);
        if (value) {
          setObstaclesConfig(value);
        }
        break;
      }
      case "CONFIG_ANCHOR_SETTINGS": {
        const value = readAnchorSettingsValue(message.reply.data);
        if (value) {
          setAnchorSettingsConfig(value);
        }
        break;
      }
      case "CONFIG_PROFILES": {
        const value = readProfilesConfigValue(message.reply.data);
        if (value) {
          setProfilesConfig(value);
        }
        break;
      }
      case "CONFIG_SYSTEM": {
        const value = readSystemConfigValue(message.reply.data);
        if (value) {
          setSystemConfig(value);
        }
        break;
      }
      case "CONFIG_WLAN": {
        const value = readWlanConfigValue(message.reply.data);
        if (value) {
          setWlanConfig(value);
        }
        break;
      }
      case "CONFIG_CLOUD": {
        const value = readCloudConfigValue(message.reply.data);
        if (value) {
          if (connection.kind === "bluetooth") {
            if (value.boat_id.trim()) {
              setBoatId(value.boat_id.trim());
            }
            if (value.cloud_secret.trim()) {
              setCloudSecret(value.cloud_secret.trim());
            }
          }
          setCloudConfig(value);
        }
        break;
      }
      case "TRACK_BACKFILL": {
        const track = readTrackBackfill(message.reply.data);
        if (track.length > 0) {
          replaceTrackPoints([...appState.deviceData.track, ...track]);
        }
        break;
      }
      default:
        break;
    }

    refreshDerivedDeviceState();
  }

  private tickDeviceSummary(): void {
    refreshDerivedDeviceState();

    if (appState.latestSource !== "--") {
      setSummarySource(appState.latestSource);
      setSummaryState(this.activeConnection.isConnected() ? "DEVICE: LIVE" : "DEVICE: STALE DATA", this.activeConnection.isConnected() ? "ok" : "warn");
      return;
    }

    const ageS = Math.floor((performance.now() - appState.runtime.bootMs) / 1000);
    setTelemetry(ageS, ageS, Number.NaN, Number.NaN);
    setSummarySource("none");
    setSummaryState(this.activeConnection.isConnected() ? "DEVICE: WAITING DATA" : "DEVICE: NO LINK", "warn");
  }
}

export const deviceLinker = new DeviceLinker(defaultConnectionForRuntimeMode(appState.connection.runtimeMode));
