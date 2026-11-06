import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Role } from "../types";

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-8 text-sm text-ink/60">Loading session…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="p-8">
        <h2 className="text-lg font-semibold">Access denied</h2>
        <p className="mt-1 text-sm text-ink/70">Your role ({user.role}) cannot open this page.</p>
      </div>
    );
  }
  return <Outlet />;
}
