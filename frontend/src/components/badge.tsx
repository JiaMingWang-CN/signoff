import type { HTMLAttributes } from "react";
import { cn, type Tone } from "../lib/utils";

export function Badge({
  tone = "default",
  dot = false,
  live = false,
  mono = false,
  small = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  dot?: boolean;
  live?: boolean;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "badge",
        tone !== "default" && tone,
        live && "live",
        mono && "mono",
        small && "badge-sm",
        className,
      )}
      {...props}
    >
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
