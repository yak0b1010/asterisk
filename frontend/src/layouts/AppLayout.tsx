import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { NAV } from "../nav";
import { Button } from "../components/ui";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = NAV.filter((n) => user && n.roles.includes(user.role));
  const activeItem = NAV.find((n) => n.to === location.pathname);

  // Lock body scroll when menu is open so the page doesn't scroll behind the menu
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-[#ffd600]">
      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 flex items-center justify-between px-6 border-b-4 border-black bg-white shrink-0 shadow-[6px_6px_0_#000]">
          <div className="flex items-center gap-3">
            <button
              className="p-2 bg-white border-4 border-black shadow-[4px_4px_0_#000] hover:bg-brand hover:text-white"
              onClick={() => setOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <Menu size={22} />
            </button>
            <h2 className="font-black text-2xl tracking-tight">
              {activeItem?.label ?? "Asterisk Appliance"}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end text-right">
              <p className="text-sm font-black">{user?.fullName}</p>
              <p className="text-xs font-bold text-ink-2 capitalize">{user?.role}</p>
            </div>
            <button onClick={logout} className="p-2 bg-white border-4 border-black shadow-[4px_4px_0_#000] hover:bg-red-600 hover:text-white" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="flex-1 p-8 overflow-y-auto"><Outlet /></main>
      </div>

      {/* ── Slide-out Menu ── */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r-4 border-black shadow-[12px_12px_0_#000] transform transition-transform duration-300 ease-in-out overflow-y-auto",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="h-20 flex items-center justify-between px-6 border-b-4 border-black bg-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-black flex items-center justify-center text-white text-lg font-black">
              A
            </div>
            <span className="font-black text-xl tracking-tighter">Asterisk</span>
          </div>
          <button
            className="rounded-none p-2 bg-white border-4 border-black shadow-[4px_4px_0_#000] hover:bg-brand hover:text-white"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-2 shrink-0">
          {items.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => {
                const base = "flex items-center px-4 py-3 rounded-none font-bold text-lg transition-colors block border-l-4 border-transparent";
                const activeClasses = "bg-brand text-white shadow-[4px_4px_0_#000] border-brand";
                const inactiveClasses = "text-ink-2 hover:bg-[#ffe6d9] hover:shadow-[6px_6px_0_#000]";
                return cx(base, isActive ? activeClasses : inactiveClasses);
              }}
              onClick={() => setOpen(false)}
            >
              <span className="font-bold text-ink-2">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-6 border-t-4 border-black bg-white shrink-0">
          <Button variant="danger" size="sm" onClick={logout} className="w-full">
            Sign out
          </Button>
        </div>
      </aside>

      {/* Backdrop when menu is open */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
