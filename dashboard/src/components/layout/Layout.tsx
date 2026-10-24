import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-[268px]">
        <Topbar onMenu={() => setSidebarOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
        <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 pb-6 text-[10px] text-neutral-500 sm:px-6 lg:px-8">
          <span>Asterisk Control Center · configuration stored in PostgreSQL</span>
          <span className="mono">API v1</span>
        </footer>
      </div>
    </div>
  );
}
