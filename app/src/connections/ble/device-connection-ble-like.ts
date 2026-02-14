import type { DeviceConnection } from "../device-connection";

export interface DeviceConnectionBleLike extends DeviceConnection {
  requestPickerOnNextConnect(): void;
  refreshReconnectAvailability(): Promise<{ available: boolean; deviceName: string }>;
}
