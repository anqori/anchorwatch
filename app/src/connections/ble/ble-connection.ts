import { Capacitor } from "@capacitor/core";
import { BLE_DEVICE_NAME_PREFIX } from "../../core/constants";

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
  device.addEventListener("gattserverdisconnected", options.onDisconnected);

  if (!device.gatt) {
    throw new Error("GATT unavailable on selected device");
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(options.serviceUuid);
  const controlTx = await service.getCharacteristic(options.controlTxUuid);
  const eventRx = await service.getCharacteristic(options.eventRxUuid);
  const snapshot = await service.getCharacteristic(options.snapshotUuid);
  const auth = await service.getCharacteristic(options.authUuid);

  await eventRx.startNotifications();
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
  if (!isWebBleSupported()) {
    throw new Error("Web Bluetooth unavailable");
  }

  if (knownDevice) {
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
      const device = await navigator.bluetooth.requestDevice(request);
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
