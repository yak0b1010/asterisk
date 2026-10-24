import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cx } from "../lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, { icon: typeof Info; ring: string; iconClass: string }> = {
  success: {
    icon: CheckCircle2,
    ring: "border-white/20",
    iconClass: "text-neutral-200",
  },
  error: {
    icon: AlertTriangle,
    ring: "border-white/30",
    iconClass: "text-white",
  },
  info: {
    icon: Info,
    ring: "border-white/15",
    iconClass: "text-neutral-300",
  },
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const style = KIND_STYLES[toast.kind];
  const Icon = style.icon;

  return (
    <div
      role="status"
      className={cx(
        "animate-slide-in-right pointer-events-auto flex w-[min(92vw,380px)] items-start gap-3 rounded-xl border bg-[#24272b]/85 p-3.5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-2xl",
        style.ring,
      )}
    >
      <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", style.iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-100">{toast.title}</p>
        {toast.message ? (
          <p className="mt-0.5 break-words text-xs leading-relaxed text-neutral-400">
            {toast.message}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-4), { id, kind, title, message }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, kind === "error" ? 7000 : 4500);
    },
    [],
  );

  const success = useCallback(
    (title: string, message?: string) => push("success", title, message),
    [push],
  );
  const error = useCallback(
    (title: string, message?: string) => push("error", title, message),
    [push],
  );
  const info = useCallback(
    (title: string, message?: string) => push("info", title, message),
    [push],
  );

  const value = useMemo(
    () => ({ push, success, error, info, dismiss }),
    [push, success, error, info, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-end gap-2 p-4 sm:right-2 sm:left-auto">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
