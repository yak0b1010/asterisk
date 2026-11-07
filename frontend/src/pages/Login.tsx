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
    <div className="flex min-h-screen items-center justify-center px-6 bg-[#ffd600]">
      <div className="relative z-10 w-full max-w-md">
        <div className="nb-card p-8 shadow-none">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-black flex items-center justify-center mx-auto mb-4 text-white text-2xl font-black">
              A
            </div>
            <h1 className="text-4xl font-black tracking-tighter">Asterisk</h1>
            <p className="text-sm font-bold text-ink-2 mt-2">Appliance</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="User name" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && (
              <div className="nb-card p-3 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
                <p className="text-xs font-bold text-red-800">{error}</p>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {import.meta.env.VITE_USE_MOCK === "true" && (
            <div className="mt-8 pt-6 border-t-4 border-black">
              <p className="text-[11px] font-bold text-ink-2 text-center">
                Mock mode: admin / admin · operator / operator · viewer / viewer
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
