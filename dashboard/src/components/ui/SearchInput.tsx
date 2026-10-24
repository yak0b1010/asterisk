import { Search, X } from "lucide-react";
import { cx } from "../../lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9.5 w-full rounded-lg border border-white/10 bg-white/[0.045] pl-9 pr-8 text-sm text-neutral-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-xl placeholder:text-neutral-500 transition focus:border-neutral-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-neutral-400/15"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-500 hover:text-neutral-200"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
