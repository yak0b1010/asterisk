/** Horizontal usage bar. Colour follows load: <70 ok, <90 warning, else critical. */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const color = percent >= 90 ? "bg-bad" : percent >= 70 ? "bg-signal" : "bg-ok";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-2 overflow-hidden rounded-full bg-ink/10">
      <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

/** Minimal SVG line chart on a fixed 0–100 scale. */
export function Sparkline({ values, max = 30 }: { values: number[]; max?: number }) {
  const W = 200, H = 48;
  if (values.length < 2) return <div className="h-12" />;
  const step = W / (max - 1);
  const offset = (max - values.length) * step; // grows from the right edge
  const pts = values.map((v, i) => `${(offset + i * step).toFixed(1)},${(H - (Math.min(100, v) / 100) * H).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none" aria-hidden>
      <polygon points={`${offset},${H} ${pts.join(" ")} ${W},${H}`} className="fill-signal/10" />
      <polyline points={pts.join(" ")} fill="none" className="stroke-signal" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
