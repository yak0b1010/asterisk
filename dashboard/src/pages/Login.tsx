import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button, Field } from "../components/ui";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white md:flex">
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-signal" /> <span className="font-semibold">Asterisk Appliance</span></div>
        <div>
          <p className="max-w-sm text-3xl font-semibold leading-tight">Run your phone system from one console.</p>
          <p className="mt-3 max-w-sm text-white/60">Extensions, queues, IVR menus and call records, applied to Asterisk as you save.</p>
        </div>
        <p className="text-xs text-white/40">Université Kasdi Merbah Ouargla — ASR2</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-ink/60">Use your administrator account.</p>
          </div>
          <Field label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          {import.meta.env.VITE_USE_MOCK === "true" && (
            <p className="text-xs text-ink/50">Mock mode: admin / admin, operator / operator, viewer / viewer</p>
          )}
        </form>
      </div>
    </div>
  );
}
