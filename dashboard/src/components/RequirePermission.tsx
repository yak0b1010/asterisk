import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { Card } from "./ui/Card";

export function FullPageLoader({ label = "Connecting to control plane…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <img src="/logo.svg" alt="" className="h-14 w-14 animate-pulse rounded-2xl" />
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label}
      </div>
    </div>
  );
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { can, status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader label="Checking permissions…" />;

  if (!can(permission)) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldX className="h-6 w-6" />}
          title="You don't have access to this area"
          description={
            <>
              Your role does not include the{" "}
              <span className="mono text-neutral-400">{permission}</span> permission.
              Ask an administrator if you believe this is a mistake.
            </>
          }
          action={
            <Link to="/">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return <div key={location.pathname}>{children}</div>;
}
