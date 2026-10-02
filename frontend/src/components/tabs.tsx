import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  badge?: ReactNode;
};

// Underline tabs; the orange ink slides to the selected tab.
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
  label?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const active = root.current?.querySelector<HTMLElement>(
        '[aria-selected="true"]',
      );
      if (active) setInk({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [value, items.length]);
  return (
    <div
      ref={root}
      className={cn("tabs", className)}
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.badge !== undefined && item.badge !== null && item.badge}
        </button>
      ))}
      {ink && <span className="ink" style={ink} />}
    </div>
  );
}

// Compact segmented control for view modes and filters.
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: ReactNode }[];
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
