import { Check, Hand, Loader2, Minus, X } from "lucide-react";
import { statusDot } from "../lib/utils";

// Round status marker for run / scan / repo statuses.
export function StatusDot({ status }: { status: string }) {
  const kind = statusDot(status);
  return (
    <span className={"status-dot " + kind}>
      {kind === "ok" ? (
        <Check />
      ) : kind === "run" ? (
        <Loader2 className="spin" />
      ) : kind === "fail" ? (
        <X />
      ) : kind === "wait" ? (
        <Hand />
      ) : (
        <Minus />
      )}
    </span>
  );
}
