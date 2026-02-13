export function loadStoredString(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in constrained contexts.
  }
}

export function normalizeRelayBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function maskSecret(secret: string): string {
  if (!secret) {
    return "not stored";
  }
  if (secret.length <= 10) {
    return "stored";
  }
  return `stored (${secret.slice(0, 6)}...${secret.slice(-4)})`;
}
