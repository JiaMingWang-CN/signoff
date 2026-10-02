import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";

// Modal built on the native <dialog>: focus trap, Esc, top layer and inertness
// of the page behind come from the browser. It is mounted only while open.
export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  size = "md",
  sheet = false,
  flush = false,
  header,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: "narrow" | "md" | "wide";
  sheet?: boolean;
  flush?: boolean;
  header?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={cn("dlg", size !== "md" && size, sheet && "sheet")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Clicking the backdrop lands on the <dialog> element itself, outside its box.
        const box = ref.current!.getBoundingClientRect();
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom;
        if (e.target === ref.current && outside) onClose();
      }}
    >
      <div className="dlg-head">
        <div className="grow">
          {header}
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭详情"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className={cn("dlg-body", flush && "flush")}>{children}</div>
      {footer && <div className="dlg-foot">{footer}</div>}
    </dialog>
  );
}
