/** Horizontal usage bar. Neo-brutalist: solid bar, black outline, hard shadow. */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const color = percent >= 90 ? "bg-red-600" : percent >= 70 ? "bg-orange-500" : "bg-green-500";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="w-full h-4 rounded-none border-4 border-black bg-white shadow-[8px_8px_0_#000]">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

/** Minimal SVG line chart on a fixed 0–100 scale. Neo-brutalist: thick stroke, black outline. */
export function Sparkline({ values, max = 30 }: { values: number[]; max?: number }) {
  const W = 200, H = 40;
  if (values.length < 2) return <div className="h-14" />;
  const step = W / (max - 1);
  const offset = (max - values.length) * step;
  const pts = values.map((v, i) => `${(offset + i * step).toFixed(1)},${(H - (Math.min(100, v) / 100) * H).toFixed(1)}`);
  return (
    <div className="nb-card p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={pts.join(" ")} />
      </svg>
    </div>
  );
}
