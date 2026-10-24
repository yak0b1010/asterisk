import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { FullPageLoader, RequirePermission } from "./components/RequirePermission";
import { useAuth } from "./context/AuthContext";
import AccountPage from "./pages/AccountPage";
import AuditPage from "./pages/AuditPage";
import BackupsPage from "./pages/BackupsPage";
import CDRPage from "./pages/CDRPage";
import ConferencesPage from "./pages/ConferencesPage";
import DashboardPage from "./pages/DashboardPage";
import DialplanPage from "./pages/DialplanPage";
import ExtensionsPage from "./pages/ExtensionsPage";
import IVRPage from "./pages/IVRPage";
import LoginPage from "./pages/LoginPage";
import MonitoringPage from "./pages/MonitoringPage";
import NotFoundPage from "./pages/NotFoundPage";
import QueuesPage from "./pages/QueuesPage";
import SettingsPage from "./pages/SettingsPage";
import UsersPage from "./pages/UsersPage";
import VoicemailPage from "./pages/VoicemailPage";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import { EmptyState } from "./components/ui/EmptyState";
import { ShieldX } from "lucide-react";

function LoginRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageLoader label="Restoring session…" />;
  if (status === "authenticated") {
    const state = location.state as { from?: string } | null;
    return <Navigate to={state?.from && state.from !== "/login" ? state.from : "/"} replace />;
  }
  return <LoginPage />;
}

function ProtectedLayout() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (status === "anonymous") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Layout />;
}

function NoPermissionPage() {
  return (
    <Card>
      <EmptyState
        icon={<ShieldX className="h-6 w-6 text-neutral-300" />}
        title="Nothing to show here"
        description="Your account does not have the dashboard.read permission. Ask an administrator for access."
        action={
          <Link to="/account">
            <Button variant="secondary">Open account settings</Button>
          </Link>
        }
      />
    </Card>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedLayout />}>
        <Route
          index
          element={
            <RequirePermission permission="dashboard.read">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="extensions"
          element={
            <RequirePermission permission="extensions.read">
              <ExtensionsPage />
            </RequirePermission>
          }
        />
        <Route
          path="dialplan"
          element={
            <RequirePermission permission="dialplan.read">
              <DialplanPage />
            </RequirePermission>
          }
        />
        <Route
          path="voicemail"
          element={
            <RequirePermission permission="voicemail.read">
              <VoicemailPage />
            </RequirePermission>
          }
        />
        <Route
          path="queues"
          element={
            <RequirePermission permission="queues.read">
              <QueuesPage />
            </RequirePermission>
          }
        />
        <Route
          path="ivr"
          element={
            <RequirePermission permission="ivr.read">
              <IVRPage />
            </RequirePermission>
          }
        />
        <Route
          path="conferences"
          element={
            <RequirePermission permission="conferences.read">
              <ConferencesPage />
            </RequirePermission>
          }
        />
        <Route
          path="cdr"
          element={
            <RequirePermission permission="cdr.read">
              <CDRPage />
            </RequirePermission>
          }
        />
        <Route
          path="monitoring"
          element={
            <RequirePermission permission="monitoring.read">
              <MonitoringPage />
            </RequirePermission>
          }
        />
        <Route
          path="backups"
          element={
            <RequirePermission permission="backups.read">
              <BackupsPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users.read">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="settings.read">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit.read">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route path="account" element={<AccountPage />} />
        <Route path="forbidden" element={<NoPermissionPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
