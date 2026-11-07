import { useEffect, useState, type ReactNode } from "react";
import { usePolling } from "../api/usePolling";
import { Meter, Sparkline } from "../components/charts";
import { Badge, DataTable, PageHeader, StatCard, Dropdown, type Column } from "../components/ui";
import { formatDuration, formatTime } from "../utils/format";
import type { CallStatus, DashboardSummary, RecentCall, SystemMetrics } from "../types";

const HISTORY = 30;
const statusTone: Record<CallStatus, "ok" | "bad" | "warn"> = { answered: "ok", missed: "warn", busy: "warn", failed: "bad" };

const callColumns: Column<RecentCall>[] = [
  { header: "Time", cell: (c) => formatTime(c.startedAt), className: "tabular-nums w-28" },
  { header: "From", cell: (c) => c.caller },
  { header: "To", cell: (c) => c.callee },
  { header: "Duration", cell: (c) => (c.durationSec ? formatDuration(c.durationSec) : "—"), className: "tabular-nums w-20" },
  { header: "Result", cell: (c) => <Badge tone={statusTone[c.status]}>{c.status}</Badge> },
];

function Panel({
  title,
  value,
  detail,
  children,
}: {
  title: string;
  value: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="nb-card p-5 h-full">
      <div className="flex items-baseline justify-between mb-3">
        <p className="nb-panel-title">{title}</p>
        <p className="text-4xl font-black tabular-nums">{value}</p>
      </div>
      <p className="text-xs font-bold text-ink-2 mb-5">{detail}</p>
      {children && <div>{children}</div>}
    </div>
  );
}

export default function Dashboard() {
  const summary = usePolling<DashboardSummary>("/dashboard/summary", 5000);
  const metrics = usePolling<SystemMetrics>("/system/metrics", 3000);
  const [history, setHistory] = useState<SystemMetrics[]>([]);

  useEffect(() => {
    if (metrics.data) setHistory((h) => [...h, metrics.data!].slice(-HISTORY));
  }, [metrics.data]);

  const s = summary.data;
  const m = metrics.data;
  const error = summary.error ?? metrics.error;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={summary.updatedAt ? `Updated ${formatTime(summary.updatedAt)}` : "Loading…"}
        actions={
          <Dropdown
            triggerLabel="Actions"
            items={[
              { label: "Refresh data", value: "refresh", onClick: () => window.location.reload() },
              { label: "Export CDR", value: "export", onClick: () => alert("Exporting CDR data…") },
              { label: "View settings", value: "settings", onClick: () => alert("Opening settings…") },
              { label: "Sign out", value: "logout", onClick: () => alert("Signing out…"), danger: true },
            ]}
          />
        }
      />

      {error && (
        <div className="mb-8 nb-card p-4 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
          <p className="text-xs font-bold text-red-800">⚠ Can’t reach the server ({error}). Retrying automatically.</p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Asterisk status"
          value={s ? <Badge tone={s?.asterisk.status === "running" ? "status-running" : s?.asterisk.status === "degraded" ? "status-degraded" : "status-stopped"}>{s.asterisk.status}</Badge> : "—"}
          hint={s ? `v${s.asterisk.version} · uptime ${formatDuration(s.asterisk.uptimeSec)}` : undefined}
          cardClass={s?.asterisk.status === "running" ? "border-brand shadow-[4px_4px_0_#d63200]" : ""}
        />
        <StatCard
          label="Registered extensions"
          value={s ? `${s.extensions.registered} / ${s.extensions.total}` : "—"}
          hint={s ? `${s.extensions.total - s.extensions.registered} offline` : undefined}
        />
        <StatCard label="Active calls" value={s?.calls.active ?? "—"} hint={s ? `avg call ${formatDuration(s.calls.avgDurationSec)}` : undefined} />
        <StatCard
          label="Calls today"
          value={s?.calls.today ?? "—"}
          hint={s ? `${s.calls.answered} answered, ${s.calls.missed} missed` : undefined}
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <Panel title="CPU usage" value={m ? `${m.cpuPercent.toFixed(0)}%` : "—"} detail="Last 90 seconds">
          <Sparkline values={history.map((h) => h.cpuPercent)} max={HISTORY} />
        </Panel>
        <Panel title="Memory usage" value={m ? `${m.memoryPercent.toFixed(0)}%` : "—"} detail={m ? `${m.memoryUsedMb} of ${m.memoryTotalMb} MB used` : "Last 90 seconds"}>
          <Sparkline values={history.map((h) => h.memoryPercent)} max={HISTORY} />
        </Panel>
        <Panel title="Disk usage" value={m ? `${m.diskPercent.toFixed(0)}%` : "—"} detail={m ? `${m.diskUsedGb.toFixed(1)} of ${m.diskTotalGb} GB used` : "—"}>
          <Meter percent={m?.diskPercent ?? 0} label="Disk usage" />
        </Panel>
      </div>

      <div className="mt-10">
        <div className="nb-card shadow-none">
          <div className="p-5 border-b-4 border-black flex items-center justify-between">
            <h3 className="text-lg font-black">Recent calls</h3>
            <p className="text-xs font-bold text-ink-2">Last 8 completed calls</p>
          </div>
          <DataTable
            columns={callColumns}
            rows={s?.recentCalls ?? []}
            rowKey={(c) => c.id}
            empty={s ? "No calls yet today." : "Loading…"}
          />
        </div>
      </div>
    </>
  );
}
