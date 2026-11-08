/* ── App shell: navigation, auth state, logout ── */
import { api, clearSession, getUser, isAuthenticated, testConnection } from "./api.js";

document.addEventListener("DOMContentLoaded", async () => {
  const user = getUser();
  const isAuth = isAuthenticated();

  // If on a protected page and not authenticated -> login
  const protectedPages = [
    "dashboard.html", "extensions.html", "users.html",
    "dialplan.html", "voicemail.html", "queues.html", "ivr.html", "cdr.html"
  ];
  const current = window.location.pathname.split("/").pop();
  const isLogin = current === "index.html" || current === "";

  if (!isAuth && protectedPages.includes(current)) {
    window.location.href = "index.html";
    return;
  }
  if (isAuth && isLogin) {
    window.location.href = "dashboard.html";
    return;
  }

  // Connection check (non-blocking)
  try {
    const conn = await testConnection();
    if (!conn.ok) {
      const alertDiv = document.createElement("div");
      alertDiv.className = "alert error";
      alertDiv.innerHTML = "<strong>Backend not reachable:</strong> " + conn.error +
        "<br>Make sure the backend container is running on port 5000 and you opened the UI via http://localhost:8080";
      document.body.insertBefore(alertDiv, document.body.firstChild);
    }
  } catch (_) {
    // ignore — testConnection already catches
  }

  renderUser(user);

  // Logout buttons
  document.querySelectorAll("[data-logout]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      api("/auth/logout", { method: "POST" }).catch(() => {});
      clearSession();
      window.location.href = "index.html";
    });
  });

  // Highlight active sidebar link
  const links = document.querySelectorAll(".sidebar-nav a");
  links.forEach((a) => {
    const href = a.getAttribute("href");
    if (href && current && href !== "index.html" && current === href) {
      a.classList.add("active");
    }
  });
});

function renderUser(user) {
  const els = document.querySelectorAll("[data-user]");
  els.forEach((el) => {
    el.textContent = (user && user.username) ? user.username : "guest";
  });
  const roleEls = document.querySelectorAll("[data-user-role]");
  roleEls.forEach((el) => {
    el.textContent = (user && user.role) ? user.role.toUpperCase() : "";
  });
}

export { api };
