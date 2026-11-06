import { mockRequest, MockHttpError } from "./mock";

const BASE = import.meta.env.VITE_API_URL ?? "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const TOKEN_KEY = "asterisk.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function api<T>(path: string, { method = "GET", body }: Options = {}): Promise<T> {
  try {
    if (USE_MOCK) return await mockRequest<T>(method, path, body);

    const token = tokenStore.get();
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => null))?.message ?? res.statusText;
      throw new ApiError(res.status, msg);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  } catch (e) {
    const err = e instanceof MockHttpError ? new ApiError(e.status, e.message) : e;
    // Any 401 outside the login call means the session is gone.
    if (err instanceof ApiError && err.status === 401 && path !== "/auth/login") {
      tokenStore.clear();
      window.dispatchEvent(new Event("auth:expired"));
    }
    throw err;
  }
}
