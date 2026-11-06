import type { AuthUser, LoginResponse } from "../types";
import { tokenStore } from "./client";
import { mockCrud } from "./mock-crud";
import { MockHttpError } from "./mock-errors";
import { mockMetrics, mockSummary } from "./mock-data";

// Mock accounts: admin/admin, operator/operator, viewer/viewer
const accounts: Record<string, { password: string; user: AuthUser }> = {
  admin: { password: "admin", user: { username: "admin", fullName: "System Administrator", role: "admin" } },
  operator: { password: "operator", user: { username: "operator", fullName: "Call Center Operator", role: "operator" } },
  viewer: { password: "viewer", user: { username: "viewer", fullName: "Read-only Viewer", role: "viewer" } },
};

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export { MockHttpError };

/** Routes mock requests by "METHOD /path". Add new endpoints here as each step is built. */
export async function mockRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await delay();
  const route = `${method} ${path.split("?")[0]}`;

  switch (route) {
    case "POST /auth/login": {
      const { username, password } = body as { username: string; password: string };
      const acc = accounts[username];
      if (!acc || acc.password !== password) throw new MockHttpError(401, "Invalid username or password");
      const res: LoginResponse = { token: `mock.${username}`, user: acc.user };
      return res as T;
    }
    case "GET /auth/me": {
      const name = tokenStore.get()?.replace("mock.", "") ?? "";
      const acc = accounts[name];
      if (!acc) throw new MockHttpError(401, "Session expired");
      return acc.user as T;
    }
    case "POST /auth/logout":
      return undefined as T;
    case "GET /dashboard/summary":
      return mockSummary() as T;
    case "GET /system/metrics":
      return mockMetrics() as T;
    default:
      return mockCrud<T>(method, path, body);
  }
}
