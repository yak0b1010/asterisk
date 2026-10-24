import { cx } from "../../lib/utils";

export interface BarDatum {
  label: string;
  value: number;
  secondary?: number;
}

export function SparkBars({
  data,
  height = 140,
  emptyLabel = "No activity yet",
  className,
}: {
  data: BarDatum[];
  height?: number;
  emptyLabel?: string;
  className?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className={cx(
          "flex items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-neutral-500",
          className,
        )}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className={cx("w-full", className)}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((item) => {
          const totalHeight = Math.max(2, (item.value / max) * 100);
          const answered =
            item.secondary === undefined
              ? null
              : Math.max(0, Math.min(100, (item.secondary / max) * 100));
          return (
            <div
              key={item.label}
              className="group relative flex h-full flex-1 items-end"
              title={`${item.label}: ${item.value}${item.secondary !== undefined ? ` (${item.secondary} answered)` : ""}`}
            >
              <div
                className="relative w-full overflow-hidden rounded-t-[3px] bg-white/[0.08] transition-colors group-hover:bg-white/[0.14]"
                style={{ height: `${totalHeight}%` }}
              >
                {answered !== null ? (
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-gradient-to-t from-neutral-600 to-neutral-400"
                    style={{ height: `${(answered / totalHeight) * 100}%` }}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-600/70 to-neutral-400/80" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((item, index) => (
          <div
            key={item.label}
            className="flex-1 truncate text-center text-[9px] text-neutral-500"
          >
            {index % Math.ceil(data.length / 7) === 0
              ? item.label.slice(5)
              : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
