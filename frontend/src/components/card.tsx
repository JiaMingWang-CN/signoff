import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

export function Card({
  flex = false,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { flex?: boolean }) {
  return (
    <section className={cn("card", flex && "flex", className)} {...props} />
  );
}

export function CardHeader({
  title,
  action,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card-head">
      {title !== undefined && <h3>{title}</h3>}
      {children}
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

export function CardBody({
  fill = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { fill?: boolean }) {
  return (
    <div
      className={cn("card-body", fill && "fill", className)}
      {...props}
    />
  );
}

export function CardFoot({ children }: { children: ReactNode }) {
  return <div className="card-foot">{children}</div>;
}
