export interface NotificationUiState {
  permissionText: string;
  statusText: string;
}

export function initNotificationStatus(state: NotificationUiState): void {
  if (!("Notification" in window)) {
    state.permissionText = "unsupported";
    state.statusText = "Notification API not supported by this browser.";
    return;
  }

  state.permissionText = Notification.permission;
  state.statusText = Notification.permission === "granted"
    ? "Permission granted. Test notification is available."
    : "Permission not granted yet.";
}

export async function requestNotificationPermission(state: NotificationUiState): Promise<void> {
  if (!("Notification" in window)) {
    throw new Error("Notification API unavailable");
  }
  const permission = await Notification.requestPermission();
  state.permissionText = permission;
  state.statusText = permission === "granted"
    ? "Permission granted."
    : `Permission status: ${permission}`;
}

export async function sendTestNotification(state: NotificationUiState): Promise<void> {
  if (!("Notification" in window)) {
    throw new Error("Notification API unavailable");
  }
  if (Notification.permission !== "granted") {
    throw new Error("Notification permission is not granted");
  }

  const title = "Anqori AnchorWatch test alert";
  const body = "Notification path works in this browser session.";
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      tag: `am-test-${Date.now()}`,
    });
  } else {
    // Fallback when no service worker registration is available.
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  }
  state.statusText = `Test sent at ${new Date().toLocaleTimeString()}`;
}
