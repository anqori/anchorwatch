import {
  BLE_AUTH_UUID,
  BLE_CHUNK_TIMEOUT_MS,
  BLE_CONTROL_TX_UUID,
  BLE_EVENT_RX_UUID,
  BLE_SERVICE_UUID,
  BLE_SNAPSHOT_UUID,
} from "../../core/constants";
import type {
  DeviceConnectionProbeResult,
  DeviceConnectionPhase,
  DeviceConnectionStatus,
} from "../device-connection";
import { DeviceConnectionBase } from "../device-connection-base";
import type { DeviceConnectionBleLike } from "./device-connection-ble-like";
import { connectBleWithCharacteristics, disconnectBleDevice, listGrantedBleDevices } from "./ble-connection";
import { consumeChunkedBleFrame } from "./ble-session";
import { makeMsgId, writeChunked } from "./ble-transport";
import { dataViewToBytes, isObject, safeParseJson } from "../../services/data-utils";
import { getLastBleDeviceId, getLastBleDeviceName, setLastBleDevice } from "../../services/persistence-domain";
import { logLine } from "../../state/app-state.svelte";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class DeviceConnectionBle extends DeviceConnectionBase implements DeviceConnectionBleLike {
  readonly kind = "bluetooth" as const;

  private device: BluetoothDevice | null = null;

  private controlTx: BluetoothRemoteGATTCharacteristic | null = null;

  private eventRx: BluetoothRemoteGATTCharacteristic | null = null;

  private auth: BluetoothRemoteGATTCharacteristic | null = null;

  private reconnectDevice: BluetoothDevice | null = null;

  private forceRequestPicker = false;

  private connectPromise: Promise<void> | null = null;

  private disconnectPromise: Promise<void> | null = null;

  private chunkAssemblies = new Map<string, { partCount: number; parts: Array<string | null>; updatedAt: number }>();

  requestPickerOnNextConnect(): void {
    this.forceRequestPicker = true;
  }

  async refreshReconnectAvailability(): Promise<{ available: boolean; deviceName: string }> {
    const device = await this.resolveReconnectDevice();
    return {
      available: Boolean(device),
      deviceName: device?.name?.trim() || getLastBleDeviceName(),
    };
  }

  async refreshAuthState(): Promise<Record<string, unknown> | null> {
    const authState = await this.readAuthState();
    this.setTransportStatus({
      connected: this.isConnected(),
      phase: this.resolvePhase(),
      deviceName: this.device?.name?.trim() || getLastBleDeviceName(),
      authState,
    });
    return authState;
  }

  async connect(): Promise<void> {
    if (this.isConnected() && this.device?.gatt?.connected && this.controlTx) {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    const run = async (): Promise<void> => {
      const startedAt = performance.now();
      if (this.disconnectPromise) {
        await this.disconnectPromise;
      }

      this.setTransportStatus({
        connected: false,
        phase: "connecting",
        deviceName: this.device?.name?.trim() || getLastBleDeviceName(),
        authState: null,
      });

      const usePicker = this.forceRequestPicker;
      const knownDevice = usePicker ? null : await this.resolveReconnectDevice();
      this.forceRequestPicker = false;
      if (!usePicker && !knownDevice) {
        throw new Error("No previously granted BLE device. Use Bluetooth search once.");
      }

      const result = await connectBleWithCharacteristics({
        serviceUuid: BLE_SERVICE_UUID,
        controlTxUuid: BLE_CONTROL_TX_UUID,
        eventRxUuid: BLE_EVENT_RX_UUID,
        snapshotUuid: BLE_SNAPSHOT_UUID,
        authUuid: BLE_AUTH_UUID,
        onDisconnected: this.onBleDisconnected as EventListener,
        onNotification: this.onBleNotification as EventListener,
      }, knownDevice);

      this.device = result.device;
      this.controlTx = result.controlTx;
      this.eventRx = result.eventRx;
      this.auth = result.auth;
      this.chunkAssemblies.clear();
      this.reconnectDevice = result.device;
      setLastBleDevice(result.device.id, result.device.name?.trim() || "");

      const authReadStartedAt = performance.now();
      const authState = await this.readAuthState();
      logLine(`BLE connect: auth.readValue done (+${Math.round(performance.now() - authReadStartedAt)}ms, total ${Math.round(performance.now() - startedAt)}ms)`);
      this.setTransportStatus({
        connected: true,
        phase: "connected",
        deviceName: result.device.name?.trim() || "",
        authState,
      });
      logLine(`BLE connect: ready (+${Math.round(performance.now() - startedAt)}ms)`);
    };

    this.connectPromise = run().finally(() => {
      this.connectPromise = null;
      if (this.isConnected()) {
        this.setTransportStatus({
          connected: true,
          phase: "connected",
          deviceName: this.device?.name?.trim() || getLastBleDeviceName(),
          authState: super.currentStatus().authState ?? null,
        });
      }
    });
    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }

    const run = async (): Promise<void> => {
      if (this.connectPromise) {
        try {
          await this.connectPromise;
        } catch {
          // ignore; cleanup still needed
        }
      }
      disconnectBleDevice(this.device);
      this.cleanupDisconnectedState();
    };

    this.disconnectPromise = run().finally(() => {
      this.disconnectPromise = null;
    });
    await this.disconnectPromise;
  }

  async probe(): Promise<DeviceConnectionProbeResult> {
    return {
      ok: this.isConnected(),
      resultText: this.isConnected() ? "BLE device available" : "BLE disconnected",
      buildVersion: null,
    };
  }

  protected async sendRaw(raw: string): Promise<void> {
    if (!this.controlTx) {
      throw new Error("BLE control characteristic unavailable");
    }
    await writeChunked(this.controlTx, makeMsgId(), raw, encoder);
  }

  protected override currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.isConnected(),
      phase: super.currentStatus().phase,
      deviceName: this.device?.name?.trim() || getLastBleDeviceName(),
      authState: super.currentStatus().authState ?? null,
    };
  }

  private async readAuthState(): Promise<Record<string, unknown> | null> {
    if (!this.auth) {
      return null;
    }
    try {
      const value = await this.auth.readValue();
      const raw = decoder.decode(dataViewToBytes(value));
      const parsed = safeParseJson(raw);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private onBleNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null;
    const value = characteristic?.value;
    if (!value) {
      return;
    }

    const bytes = dataViewToBytes(value);
    if (!bytes.length) {
      return;
    }

    let raw = "";
    if (bytes[0] === 0x7b) {
      raw = decoder.decode(bytes);
    } else {
      const frame = consumeChunkedBleFrame(
        this.chunkAssemblies,
        bytes,
        (chunk) => decoder.decode(chunk),
        BLE_CHUNK_TIMEOUT_MS,
      );
      if (frame.kind !== "complete" || !frame.raw) {
        return;
      }
      raw = frame.raw;
    }

    this.handleIncomingRaw(raw, "ble/eventRx");
  };

  private onBleDisconnected = (): void => {
    this.cleanupDisconnectedState();
  };

  private cleanupDisconnectedState(): void {
    if (!this.device && !this.controlTx && !this.eventRx && !this.auth) {
      return;
    }
    if (this.eventRx) {
      this.eventRx.removeEventListener("characteristicvaluechanged", this.onBleNotification as EventListener);
    }
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this.onBleDisconnected as EventListener);
    }

    this.device = null;
    this.controlTx = null;
    this.eventRx = null;
    this.auth = null;
    this.chunkAssemblies.clear();
    this.handleTransportDisconnected("BLE disconnected");
  }

  private resolvePhase(): DeviceConnectionPhase {
    if (this.connectPromise) {
      return "connecting";
    }
    if (this.isConnected()) {
      return "connected";
    }
    return "disconnected";
  }

  private async resolveReconnectDevice(): Promise<BluetoothDevice | null> {
    if (this.reconnectDevice) {
      return this.reconnectDevice;
    }
    const lastDeviceId = getLastBleDeviceId();
    if (!lastDeviceId) {
      return null;
    }
    const devices = await listGrantedBleDevices();
    const match = devices.find((device) => device.id === lastDeviceId) ?? null;
    this.reconnectDevice = match;
    return match;
  }
}
