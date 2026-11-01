import type { ErrorCode } from "@smart-speed/shared";
import { API_BASE } from "./env";
import { getAccessToken, notifyUnauthorized, setAccessToken } from "./session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly details: unknown;

  constructor(
    status: number,
    code: ErrorCode | "NETWORK_ERROR",
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Single in-flight refresh — concurrent 401s share it. */
let refreshPromise: Promise<string | null> | null = null;

/** Exchange the httpOnly refresh cookie for a fresh access token (or null). */
export async function tryRefresh(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken?: string };
        if (!data.accessToken) return null;
        setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export type QueryValue = string | number | boolean | undefined | null;

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}

async function parseError(res: Response): Promise<ApiError> {
  let code: ErrorCode | "NETWORK_ERROR" = "INTERNAL_ERROR";
  let message = res.statusText || `request failed (${res.status})`;
  let details: unknown;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body.error) {
      code = (body.error.code as ErrorCode) ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message, details);
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Internal: guards the single refresh retry. */
  retried?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, retried = false, headers, ...rest } = options;
  const token = getAccessToken();
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: requestHeaders,
      credentials: "include",
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "cannot reach the server");
  }

  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    const fresh = await tryRefresh();
    if (fresh) return apiRequest<T>(path, { ...options, retried: true });
    notifyUnauthorized();
    throw await parseError(res);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiGet = <T>(path: string): Promise<T> => apiRequest<T>(path);

export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: "POST", body });

export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: "PATCH", body });

export const apiDelete = <T>(path: string): Promise<T> => apiRequest<T>(path, { method: "DELETE" });

/** Authenticated file download (CSV / PDF) — returns a filename from the response. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers, credentials: "include" });
  if (!res.ok) throw await parseError(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return {
    blob: await res.blob(),
    filename: match?.[1] ?? path.split("/").pop() ?? "download",
  };
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
