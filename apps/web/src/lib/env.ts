const trimSlash = (v: string): string => v.replace(/\/+$/, "");

/** API base path. Defaults to same-origin `/api` (proxied by Vite in dev). */
export const API_BASE = trimSlash(import.meta.env.VITE_API_BASE ?? "/api");

/** Socket.IO URL. Empty string = same origin (proxied by Vite in dev). */
export const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL ?? "";

/** Vision service base URL (MJPEG preview + health probe). */
export const VISION_URL = trimSlash(import.meta.env.VITE_VISION_URL ?? "http://localhost:8001");

/** Token for the vision MJPEG `/live` stream (matches vision LIVE_STREAM_TOKEN). */
export const VISION_STREAM_TOKEN: string = import.meta.env.VITE_VISION_STREAM_TOKEN ?? "";

/**
 * Normalise any frame URL (absolute from socket payloads, relative from HTTP
 * APIs) to a same-origin path so it goes through the dev proxy and can carry
 * the `access_token` query parameter for `<img>` tags.
 */
export function normalizeApiUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Build a same-origin image URL for a frame file id (or full URL). */
export function frameImageUrl(
  fileIdOrUrl: string | null | undefined,
  accessToken: string | null
): string | null {
  if (!fileIdOrUrl) return null;
  const path =
    fileIdOrUrl.startsWith("http") || fileIdOrUrl.startsWith("/")
      ? normalizeApiUrl(fileIdOrUrl)
      : `${API_BASE}/frames/${fileIdOrUrl}`;
  if (!accessToken) return path;
  return `${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
}
