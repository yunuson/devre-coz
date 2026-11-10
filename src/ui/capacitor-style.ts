export type CapacitorStyle = 'straight' | 'curved';

const STORAGE_KEY = 'devre-coz.capacitor-style';

export function loadCapacitorStyle(): CapacitorStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'curved' ? 'curved' : 'straight';
  } catch {
    return 'straight';
  }
}

export function saveCapacitorStyle(style: CapacitorStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // The current session still uses the chosen appearance.
  }
}
