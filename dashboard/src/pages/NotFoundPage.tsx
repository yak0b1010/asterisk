import { Link } from "react-router-dom";
import { ArrowLeft, Compass, LayoutDashboard } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="relative w-full max-w-xl overflow-hidden">
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-neutral-500/10 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-neutral-500/[0.07] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-neutral-500/25 bg-neutral-500/10 text-neutral-300">
            <Compass className="h-7 w-7" />
          </span>
          <p className="mono mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
            HTTP 404
          </p>
          <h1 className="mt-2 text-5xl font-semibold tracking-tight text-white">404</h1>
          <h2 className="mt-3 text-base font-semibold text-neutral-200">
            This line isn't in the dialplan
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-neutral-500">
            The page you requested does not exist, may have been moved, or belongs to an
            area your account cannot access.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <Link to="/">
              <Button
                variant="primary"
                icon={<LayoutDashboard className="h-4 w-4" />}
              >
                Back to dashboard
              </Button>
            </Link>
            <Button
              variant="secondary"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => window.history.back()}
            >
              Go back
            </Button>
          </div>
          <p className="mono mt-8 text-[10px] text-neutral-500">
            Check the address or use the sidebar to find the right page.
          </p>
        </div>
      </Card>
    </div>
  );
}
