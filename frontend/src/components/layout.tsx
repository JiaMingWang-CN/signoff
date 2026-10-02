import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { cn } from "../lib/utils";
import { Button } from "./button";

export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("page", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  crumb,
  meta,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumb?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="titles">
        {crumb && (
          <div className="breadcrumb">
            {crumb}
            {typeof title === "string" && (
              <>
                <ChevronRight />
                <span>{title}</span>
              </>
            )}
          </div>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Pager({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pager">
      <span className="muted">共 {total} 条</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="上一页"
        disabled={page <= 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <span className="pg">
        {Math.min(page, pages - 1) + 1} / {pages}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="下一页"
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

// Popover menu: closes on outside click, Esc, or choosing an item.
export function Menu({
  trigger,
  children,
  align = "left",
  direction = "down",
}: {
  trigger: (props: {
    open: boolean;
    toggle: () => void;
  }) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  direction?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={root}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`menu ${align} ${direction}`}
          role="menu"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} role="menuitem">
      {children}
    </Link>
  );
}
