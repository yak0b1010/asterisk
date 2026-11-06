import type { CallStatus, DashboardSummary, RecentCall, SystemMetrics } from "../types";

const bootTime = Date.now() - (3 * 86400 + 4 * 3600) * 1000;
const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pad = (n: number) => String(n).padStart(3, "0");
const ext = () => pad(Math.floor(rnd(100, 600)));

// Random walks so charts move like a real server
let cpu = 22, mem = 48, registered = 438, active = 7, today = 186, answered = 151;

export function mockSummary(): DashboardSummary {
  registered = clamp(registered + Math.round(rnd(-3, 3)), 400, 480);
  active = clamp(active + Math.round(rnd(-2, 2)), 0, 24);
  if (Math.random() < 0.4) { today += 1; if (Math.random() < 0.8) answered += 1; }

  const statuses: CallStatus[] = ["answered", "answered", "answered", "missed", "busy", "failed"];
  const recentCalls: RecentCall[] = Array.from({ length: 6 }, (_, i) => {
    const status = statuses[Math.floor(rnd(0, statuses.length))];
    return {
      id: `c${today - i}`,
      startedAt: new Date(Date.now() - i * rnd(60_000, 240_000)).toISOString(),
      caller: ext(),
      callee: ext(),
      durationSec: status === "answered" ? Math.round(rnd(12, 480)) : 0,
      status,
    };
  });

  return {
    asterisk: { status: "running", version: "20.7.0", uptimeSec: (Date.now() - bootTime) / 1000 },
    extensions: { total: 500, registered },
    calls: { active, today, answered, missed: today - answered, avgDurationSec: 134 },
    recentCalls,
  };
}

export function mockMetrics(): SystemMetrics {
  cpu = clamp(cpu + rnd(-6, 6), 3, 97);
  mem = clamp(mem + rnd(-2, 2), 30, 90);
  const memTotal = 4096, diskTotal = 60, diskUsed = 21.4;
  return {
    timestamp: new Date().toISOString(),
    cpuPercent: Math.round(cpu * 10) / 10,
    memoryPercent: Math.round(mem * 10) / 10,
    memoryUsedMb: Math.round((mem / 100) * memTotal),
    memoryTotalMb: memTotal,
    diskPercent: Math.round((diskUsed / diskTotal) * 1000) / 10,
    diskUsedGb: diskUsed,
    diskTotalGb: diskTotal,
  };
}
