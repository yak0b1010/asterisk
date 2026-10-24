import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "../../lib/utils";

const CONTROL =
  "w-full rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-neutral-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-xl placeholder:text-neutral-500 transition focus:border-neutral-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-neutral-400/15 disabled:cursor-not-allowed disabled:opacity-60";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-neutral-400">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-neutral-400">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(CONTROL, "min-h-24 resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-xl transition",
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-white/20 hover:bg-white/[0.05]",
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "border-neutral-300/60 bg-neutral-500 shadow-[0_0_14px_-2px_rgb(255_255_255/0.3)]"
            : "border-white/15 bg-white/[0.12]",
        )}
      >
        <span
          className={cx(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "inline-flex cursor-pointer items-center gap-2 text-sm text-neutral-300",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-neutral-500 focus:ring-neutral-400/30"
      />
      {label}
    </label>
  );
}
