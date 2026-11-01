/**
 * Tiny module-level session holder shared by the API client and the auth store.
 * Lives on its own so neither module has to import the other (no cycles).
 */
let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when a refresh attempt fails — the auth store clears state and redirects. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function notifyUnauthorized(): void {
  accessToken = null;
  unauthorizedHandler?.();
}
