import type { Envelope, PageMeta, TokenEnvelope } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const ACCESS_KEY = "asterisk.access_token";
const REFRESH_KEY = "asterisk.refresh_token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  clearTokens();
  unauthorizedHandler?.();
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as Envelope<TokenEnvelope>;
      setTokens(payload.data.access_token, payload.data.refresh_token);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = "http_error";
  let message = response.statusText || `Request failed with status ${response.status}`;
  let details: unknown;
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (payload?.error) {
      code = payload.error.code ?? code;
      message = payload.error.message ?? message;
      details = payload.error.details;
    }
  } catch {
    // Non-JSON error body (proxy error, HTML page, ...).
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    message = message || "The API is unavailable";
  }
  return new ApiError(response.status, code, message, details);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  retry?: boolean;
}

function isAuthEndpoint(path: string): boolean {
  return (
    path.startsWith("/api/v1/auth/login") ||
    path.startsWith("/api/v1/auth/refresh")
  );
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const { method = "GET", body, signal, auth = true, retry = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAccessToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the API. Check that the backend is running and reachable.",
    );
  }

  if (response.status === 401 && auth && retry && !isAuthEndpoint(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retry: false });
    }
    handleUnauthorized();
    throw await parseError(response);
  }

  if (!response.ok) {
    if (response.status === 401 && auth) handleUnauthorized();
    throw await parseError(response);
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  const text = await response.text();
  if (!text) return { data: undefined as T };
  return JSON.parse(text) as Envelope<T>;
}

export async function apiGet<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const envelope = await apiRequest<T>(path, { signal });
  return envelope.data;
}

export interface ListResult<T> {
  items: T[];
  meta: PageMeta;
}

export async function apiList<T>(
  path: string,
  signal?: AbortSignal,
): Promise<ListResult<T>> {
  const envelope = await apiRequest<T[]>(path, { signal });
  const items = Array.isArray(envelope.data) ? envelope.data : [];
  return {
    items,
    meta:
      envelope.meta ?? {
        page: 1,
        limit: items.length,
        total: items.length,
        pages: items.length > 0 ? 1 : 0,
      },
  };
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: "POST", body });
  return envelope.data;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: "PUT", body });
  return envelope.data;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: "PATCH", body });
  return envelope.data;
}

export async function apiDelete(path: string): Promise<void> {
  await apiRequest<void>(path, { method: "DELETE" });
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : null;
}

export async function apiDownload(
  path: string,
  fallbackName: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await fetch(API_BASE + path, { headers });
  if (response.status === 401 && (await refreshAccessToken())) {
    const refreshedToken = getAccessToken();
    if (refreshedToken) headers.Authorization = `Bearer ${refreshedToken}`;
    response = await fetch(API_BASE + path, { headers });
  }
  if (!response.ok) throw await parseError(response);

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ??
    fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(
  params: Record<string, QueryValue>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text === "") continue;
    query.set(key, text);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
