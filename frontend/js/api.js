/* ── API client (vanilla fetch) ── */
const API_BASE = window.API_BASE || "";

let token = () => localStorage.getItem("token");

export async function api(path, { method = "GET", body, headers = {}, requiresAuth = true } = {}) {
  const h = { ...headers };
  if (requiresAuth) {
    const t = token();
    if (t) h["Authorization"] = `Bearer ${t}`;
  }
  if (body && !(body instanceof FormData)) {
    h["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: h,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : null,
  });

  // 401 -> logout
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (window.location.pathname !== "/index.html") {
      window.location.href = "index.html";
    }
    throw new Error("unauthenticated");
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json();
  }
  if (ct.includes("text/csv")) {
    return await res.text();
  }
  return await res.text();
}

export const get = (p, o) => api(p, { ...o, method: "GET" });
export const post = (p, b, o) => api(p, { ...o, method: "POST", body: b });
export const put = (p, b, o) => api(p, { ...o, method: "PUT", body: b });
export const del = (p, o) => api(p, { ...o, method: "DELETE" });

/* ── Auth helpers ── */
export function setSession(tokenVal, user) {
  localStorage.setItem("token", tokenVal);
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

export function isAuthenticated() { return !!localStorage.getItem("token"); }
