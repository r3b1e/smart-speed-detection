/**
 * Geolocation utilities.
 * Wraps the browser Geolocation API with a Promise interface and
 * a React hook for tracking live location.
 */

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracy: number; // metres
}

export type GeoStatus = "idle" | "pending" | "ok" | "denied" | "unavailable" | "timeout";

/**
 * One-shot geolocation read.  Resolves with coords or rejects with a
 * human-readable message.
 */
export function getCurrentLocation(timeoutMs = 10_000): Promise<GeoCoords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location services are not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        }),
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(new Error("Location permission denied. Allow it in browser settings."));
            break;
          case err.POSITION_UNAVAILABLE:
            reject(new Error("Location unavailable — check GPS or Wi-Fi signal."));
            break;
          case err.TIMEOUT:
            reject(new Error("Location timed out. Try again in the open."));
            break;
          default:
            reject(new Error("Could not determine location."));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

/**
 * Formats accuracy for display, e.g. "±12 m".
 */
export function formatAccuracy(metres: number): string {
  if (metres < 1000) return `±${Math.round(metres)} m`;
  return `±${(metres / 1000).toFixed(1)} km`;
}
