import { Capacitor } from "@capacitor/core";
import { BLE_DEVICE_NAME_PREFIX } from "../../core/constants";
import { logLine } from "../../state/app-state.svelte";

export interface BleConnectOptions {
  serviceUuid: BluetoothServiceUUID;
  controlTxUuid: BluetoothCharacteristicUUID;
  eventRxUuid: BluetoothCharacteristicUUID;
  snapshotUuid: BluetoothCharacteristicUUID;
  authUuid: BluetoothCharacteristicUUID;
  onDisconnected: EventListener;
  onNotification: EventListener;
}

export interface BleConnectionResult {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
  controlTx: BluetoothRemoteGATTCharacteristic;
  eventRx: BluetoothRemoteGATTCharacteristic;
  snapshot: BluetoothRemoteGATTCharacteristic;
  auth: BluetoothRemoteGATTCharacteristic;
}

async function connectDeviceWithCharacteristics(
  device: BluetoothDevice,
  options: BleConnectOptions,
): Promise<BleConnectionResult> {
  const startedAt = performance.now();
  const mark = (label: string): void => {
    logLine(`BLE connect: ${label} (+${Math.round(performance.now() - startedAt)}ms)`);
  };

  device.addEventListener("gattserverdisconnected", options.onDisconnected);

  if (!device.gatt) {
    throw new Error("GATT unavailable on selected device");
  }

  mark(`gatt.connect() start (${device.name?.trim() || "device"})`);
  const server = await device.gatt.connect();
  mark("gatt connected");
  const service = await server.getPrimaryService(options.serviceUuid);
  mark("primary service resolved");
  const controlTx = await service.getCharacteristic(options.controlTxUuid);
  mark("controlTx characteristic resolved");
  const eventRx = await service.getCharacteristic(options.eventRxUuid);
  mark("eventRx characteristic resolved");
  const snapshot = await service.getCharacteristic(options.snapshotUuid);
  mark("snapshot characteristic resolved");
  const auth = await service.getCharacteristic(options.authUuid);
  mark("auth characteristic resolved");

  await eventRx.startNotifications();
  mark("event notifications started");
  eventRx.addEventListener("characteristicvaluechanged", options.onNotification);

  return {
    device,
    server,
    service,
    controlTx,
    eventRx,
    snapshot,
    auth,
  };
}

export async function connectBleWithCharacteristics(
  options: BleConnectOptions,
  knownDevice: BluetoothDevice | null = null,
): Promise<BleConnectionResult> {
  const startedAt = performance.now();
  if (!isWebBleSupported()) {
    throw new Error("Web Bluetooth unavailable");
  }

  if (knownDevice) {
    logLine(`BLE connect: using granted device ${knownDevice.name?.trim() || "device"} (0ms)`);
    return await connectDeviceWithCharacteristics(knownDevice, options);
  }

  const requestPlans: RequestDeviceOptions[] = [
    {
      filters: [{ services: [options.serviceUuid] }],
      optionalServices: [options.serviceUuid],
    },
    {
      filters: [{ namePrefix: BLE_DEVICE_NAME_PREFIX }],
      optionalServices: [options.serviceUuid],
    },
    {
      acceptAllDevices: true,
      optionalServices: [options.serviceUuid],
    },
  ];

  let lastError: unknown;

  for (const request of requestPlans) {
    try {
      logLine(`BLE connect: requestDevice attempt (+${Math.round(performance.now() - startedAt)}ms)`);
      const device = await navigator.bluetooth.requestDevice(request);
      logLine(`BLE connect: requestDevice returned ${device.name?.trim() || "device"} (+${Math.round(performance.now() - startedAt)}ms)`);
      return await connectDeviceWithCharacteristics(device, options);
    } catch (error) {
      const err = error as DOMException;
      const canFallback = err instanceof DOMException ? err.name === "NotFoundError" : true;
      if (!canFallback) {
        throw error;
      }
      lastError = error;
    }
  }

  const failureReason =
    lastError instanceof Error
      ? `${lastError.name}: ${lastError.message}`
      : "No compatible BLE device found";
  throw new Error(failureReason);
}

export async function listGrantedBleDevices(): Promise<BluetoothDevice[]> {
  if (!isWebBleSupported() || typeof navigator.bluetooth.getDevices !== "function") {
    return [];
  }
  try {
    return await navigator.bluetooth.getDevices();
  } catch {
    return [];
  }
}

export function isBleSupported(): boolean {
  return Capacitor.isNativePlatform() || isWebBleSupported();
}

function isWebBleSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
}

export function disconnectBleDevice(device: BluetoothDevice | null): boolean {
  if (!device?.gatt?.connected) {
    return false;
  }
  device.gatt.disconnect();
  return true;
}
