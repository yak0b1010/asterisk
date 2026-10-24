import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { Field, Input } from "./Field";
import { Modal } from "./Modal";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  loading = false,
  requireText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  requireText?: string;
}) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const matches = !requireText || text.trim() === requireText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={tone}
            onClick={onConfirm}
            loading={loading}
            disabled={!matches}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-500/25 bg-neutral-500/10 text-neutral-300">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-sm leading-relaxed text-neutral-300">
          <p>
            This action cannot be undone. Make sure you understand the impact
            before continuing.
          </p>
          {requireText ? (
            <Field
              className="mt-4"
              label={
                <>
                  Type <span className="mono text-neutral-300">{requireText}</span>{" "}
                  to confirm
                </>
              }
            >
              <Input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={requireText}
                autoFocus
              />
            </Field>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
