/* ── API client (vanilla fetch) ── */
/* Detect backend URL robustly: inline script sets window.API_BASE on each page.
   Fallback: same origin (works if nginx proxies /api to backend). */
const API_BASE = window.API_BASE || "";

// Debug: log API base on first load
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  console.debug("[api.js] API_BASE =", API_BASE);
}

let token = () => localStorage.getItem("token");

function showDebug(msg) {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    console.debug("[api.js]", msg);
  }
}

export async function api(path, { method = "GET", body, headers = {}, requiresAuth = true } = {}) {
  const h = { ...headers };
  if (requiresAuth) {
    const t = token();
    if (t) h["Authorization"] = `Bearer ${t}`;
  }
  if (body && !(body instanceof FormData)) {
    h["Content-Type"] = "application/json";
  }

  const url = `${API_BASE}/api${path}`;
  showDebug(`${method} ${url}`);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : null,
    });
  } catch (err) {
    // Network error (CORS, DNS, connection refused, etc.)
    showDebug(`Network error on ${method} ${path}:`, err.message);
    throw new Error(`Cannot reach backend at ${API_BASE || "same origin"}. Is the backend running on port 5000?`);
  }

  showDebug(`${method} ${path} → HTTP ${res.status}`);

  // 401 -> logout
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (window.location.pathname !== "/index.html") {
      window.location.href = "index.html";
    }
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    // Server returned an error (400, 409, 500, etc.)
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody.error || errBody.message || JSON.stringify(errBody);
    } catch (_) {
      detail = await res.text().catch(() => "no response body");
    }
    throw new Error(`Server error (${res.status}): ${detail}`);
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

/* ── Connection test ── */
export async function testConnection() {
  try {
    const res = await api("/health", { requiresAuth: false });
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
