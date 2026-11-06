import { LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { NAV } from "../nav";

export function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => user && n.roles.includes(user.role));
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-ink text-white transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" aria-hidden />
          <span className="font-semibold">Asterisk Appliance</span>
        </div>
        <nav className="space-y-4 overflow-y-auto p-3" onClick={() => setOpen(false)}>
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 px-2 text-xs text-white/40">{g}</p>
              {items.filter((i) => i.group === g).map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${isActive ? "bg-ink-2 text-white shadow-[inset_3px_0_0_var(--color-signal)]" : "text-white/70 hover:bg-ink-2"}`
                  }
                >
                  <Icon size={16} /> {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4">
          <button className="rounded p-1.5 hover:bg-paper md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu"><Menu size={20} /></button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <p className="font-medium">{user?.fullName}</p>
              <p className="text-xs text-ink/50">{user?.role}</p>
            </div>
            <button onClick={logout} className="rounded-md border border-line p-2 hover:bg-paper" aria-label="Sign out"><LogOut size={16} /></button>
          </div>
        </header>
        <main className="flex-1 p-6"><Outlet /></main>
      </div>
    </div>
  );
}
