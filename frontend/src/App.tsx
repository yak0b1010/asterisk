import type { ComponentType } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { NAV } from "./nav";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Placeholder from "./pages/Placeholder";

// Replace Placeholder with the real page in each step: { "/users": UsersPage, ... }
const PAGES: Record<string, ComponentType> = {
  "/": Dashboard,
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              {NAV.map(({ to, roles }) => {
                const Page = PAGES[to] ?? Placeholder;
                return (
                  <Route key={to} element={<ProtectedRoute roles={roles} />}>
                    <Route path={to} element={<Page />} />
                  </Route>
                );
              })}
              <Route path="*" element={<Placeholder />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
