import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../../lib/utils";
import { useToast } from "../../context/ToastContext";
import { cx } from "../../lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  className,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = async () => {
    try {
      await copyText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      if (!iconOnly) toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy", "Your browser blocked clipboard access.");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-neutral-400 transition hover:text-neutral-300",
        iconOnly ? "p-1.5 hover:bg-white/[0.07]" : "px-2 py-1 hover:bg-white/[0.07]",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-neutral-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {iconOnly ? null : copied ? "Copied" : label}
    </button>
  );
}
