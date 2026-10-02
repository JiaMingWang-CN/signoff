import { AlertTriangle, CircleCheck, Info, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export type AlertTone = "info" | "warning" | "danger" | "success" | "default";

const icons = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
  success: CircleCheck,
  default: Info,
};

export function Alert({
  tone = "default",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: string;
}) {
  const Icon = icons[tone];
  return (
    <div
      className={cn("alert", tone !== "default" && tone, className)}
      role={role || (tone === "danger" ? "alert" : "status")}
    >
      <Icon />
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}

// Inline status line: `error` renders as a danger alert, otherwise as info.
export function Notice({
  children,
  error = false,
  action,
}: {
  children: ReactNode;
  error?: boolean;
  action?: ReactNode;
}) {
  return (
    <Alert tone={error ? "danger" : "info"} action={action}>
      {children}
    </Alert>
  );
}

export function Empty({
  title,
  children = "暂无记录",
  icon,
  action,
}: {
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="ico">{icon || <Inbox />}</div>
      {title && <strong>{title}</strong>}
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({
  width = "60%",
  height,
  className,
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return <span className={cn("skel", className)} style={{ width, height }} />;
}
