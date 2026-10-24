import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { errorMessage } from "../lib/api";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";

const FEATURES = [
  {
    icon: Phone,
    title: "Telephony configuration",
    text: "Extensions, dialplan, voicemail, queues, IVR and conference rooms.",
  },
  {
    icon: ShieldCheck,
    title: "PostgreSQL source of truth",
    text: "Every change is persisted and mirrored to Asterisk realtime tables.",
  },
  {
    icon: KeyRound,
    title: "Role-based access",
    text: "Administrators, supervisors, agents and viewers with scoped permissions.",
  },
];

export default function LoginPage() {
  useDocumentTitle("Sign in");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate(from.startsWith("/") ? from : "/", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 surface-grid opacity-30" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-neutral-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-neutral-500/12 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 top-0 h-72 w-72 rounded-full bg-neutral-500/10 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#24272b]/55 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.09)] backdrop-blur-2xl lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden flex-col justify-between border-r border-white/10 bg-white/[0.02] p-10 lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <img
                src="/logo.svg"
                alt=""
                className="h-11 w-11 rounded-2xl drop-shadow-[0_0_22px_rgb(255_255_255/0.16)]"
              />
              <div>
                <p className="text-sm font-bold tracking-[0.2em] text-white">ASTERISK</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">
                  Control Center
                </p>
              </div>
            </div>

            <h1 className="mt-12 max-w-sm text-3xl font-semibold leading-tight tracking-tight text-white">
              Operate your PBX from a single{" "}
              <span className="text-gradient">control plane</span>.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-neutral-400">
              Configuration, monitoring and call records — backed by PostgreSQL and
              synchronized with Asterisk when the PBX is online.
            </p>

            <ul className="mt-10 space-y-5">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-400/20 bg-neutral-500/10 text-neutral-300 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-neutral-200">{feature.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                        {feature.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-neutral-600">
            <LockKeyhole className="h-3.5 w-3.5 text-neutral-500/70" />
            <span>Encrypted sessions · audited administrative actions</span>
          </div>
        </section>

        <section className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl" />
            <div>
              <p className="text-sm font-bold tracking-[0.18em] text-white">ASTERISK</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                Control Center
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400/80">
              Administrator access
            </p>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
              Sign in
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Use the credentials configured for this appliance.
            </p>
          </div>

          {error ? (
            <Alert tone="danger" title="Sign-in failed" className="mt-5">
              {error}
            </Alert>
          ) : null}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Username" htmlFor="username">
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  className="pl-9"
                  disabled={loading}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 transition hover:text-neutral-200"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-4 text-[11px] text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
            <span>API v1 · PostgreSQL backend</span>
            <a
              href="/api/v1/docs"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-neutral-500 transition hover:text-neutral-300"
            >
              API documentation
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
