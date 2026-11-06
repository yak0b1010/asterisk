import { useEffect, useState, type ReactNode } from "react";
import { usePolling } from "../api/usePolling";
import { Meter, Sparkline } from "../components/charts";
import { Badge, DataTable, PageHeader, StatCard, type Column } from "../components/ui";
import { formatDuration, formatTime } from "../utils/format";
import type { CallStatus, DashboardSummary, RecentCall, SystemMetrics } from "../types";

const HISTORY = 30;
const statusTone: Record<CallStatus, "ok" | "warn" | "bad"> = { answered: "ok", missed: "warn", busy: "warn", failed: "bad" };

const callColumns: Column<RecentCall>[] = [
  { header: "Time", cell: (c) => formatTime(c.startedAt), className: "tabular-nums" },
  { header: "From", cell: (c) => c.caller },
  { header: "To", cell: (c) => c.callee },
  { header: "Duration", cell: (c) => (c.durationSec ? formatDuration(c.durationSec) : "—"), className: "tabular-nums" },
  { header: "Result", cell: (c) => <Badge tone={statusTone[c.status]}>{c.status}</Badge> },
];

function Panel({ title, value, detail, children }: { title: string; value: string; detail: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink/60">{title}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </div>
      <div className="my-3">{children}</div>
      <p className="text-xs text-ink/50">{detail}</p>
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
  const asteriskTone = s?.asterisk.status === "running" ? "ok" : s?.asterisk.status === "degraded" ? "warn" : "bad";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={summary.updatedAt ? `Updated ${formatTime(summary.updatedAt)}` : "Loading…"}
      />

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">
          Can’t reach the server ({error}). Retrying automatically.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Asterisk"
          value={s ? <Badge tone={asteriskTone}>{s.asterisk.status}</Badge> : "—"}
          hint={s ? `v${s.asterisk.version} · up ${formatDuration(s.asterisk.uptimeSec)}` : undefined}
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

      <h2 className="mb-3 mt-8 text-base font-semibold">Server load</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="CPU" value={m ? `${m.cpuPercent.toFixed(0)}%` : "—"} detail="Last 90 seconds">
          <Sparkline values={history.map((h) => h.cpuPercent)} max={HISTORY} />
        </Panel>
        <Panel
          title="Memory"
          value={m ? `${m.memoryPercent.toFixed(0)}%` : "—"}
          detail={m ? `${m.memoryUsedMb} of ${m.memoryTotalMb} MB used` : "Last 90 seconds"}
        >
          <Sparkline values={history.map((h) => h.memoryPercent)} max={HISTORY} />
        </Panel>
        <Panel
          title="Disk"
          value={m ? `${m.diskPercent.toFixed(0)}%` : "—"}
          detail={m ? `${m.diskUsedGb.toFixed(1)} of ${m.diskTotalGb} GB used` : "—"}
        >
          <Meter percent={m?.diskPercent ?? 0} label="Disk usage" />
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold">Recent calls</h2>
      <DataTable columns={callColumns} rows={s?.recentCalls ?? []} rowKey={(c) => c.id} empty={s ? "No calls yet today." : "Loading…"} />
    </>
  );
}
