import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";

export function ErrorPanel({
  message,
  onRetry,
  title = "Could not load data",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6 text-neutral-300" />}
        title={title}
        description={message}
        action={
          onRetry ? (
            <Button variant="secondary" icon={<RotateCw className="h-4 w-4" />} onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    </Card>
  );
}
