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

export async function connectBleWithCharacteristics(options: BleConnectOptions): Promise<BleConnectionResult> {
  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth unavailable");
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [options.serviceUuid] }],
    optionalServices: [options.serviceUuid],
  });
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

export function disconnectBleDevice(device: BluetoothDevice | null): boolean {
  if (!device?.gatt?.connected) {
    return false;
  }
  device.gatt.disconnect();
  return true;
}
