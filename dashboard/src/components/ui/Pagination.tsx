import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../../lib/utils";

function pageWindow(page: number, pages: number): number[] {
  if (pages <= 5) {
    return Array.from({ length: pages }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export function Pagination({
  page,
  pages,
  total,
  limit,
  onPageChange,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  const window = pageWindow(page, pages);

  return (
    <div
      className={cx(
        "flex flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-xs text-neutral-500">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing <span className="font-medium text-neutral-300">{from}</span>–
            <span className="font-medium text-neutral-300">{to}</span> of{" "}
            <span className="font-medium text-neutral-300">{total}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-neutral-400 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {window.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            className={cx(
              "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold transition",
              item === page
                ? "border border-neutral-300/30 bg-gradient-to-b from-neutral-400 to-neutral-500 text-neutral-950 shadow-[0_8px_20px_-10px_rgb(255_255_255/0.25),inset_0_1px_0_rgb(255_255_255/0.3)]"
                : "border border-transparent text-neutral-400 hover:bg-white/[0.07] hover:text-white",
            )}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-neutral-400 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
