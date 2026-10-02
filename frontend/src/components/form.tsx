import { Search } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/utils";

export function Input({
  className,
  mono,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={cn("input", mono && "mono", className)} {...props} />;
}

export function SearchInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("input-wrap", className)}>
      <Search />
      <input className="input" {...props} />
    </label>
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("select", className)} {...props} />;
}

export function Textarea({
  className,
  mono,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea className={cn("textarea", mono && "mono", className)} {...props} />
  );
}

// Label + control + optional hint. The label wraps the control so it is the
// control's accessible name when the control has no aria-label of its own.
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("field", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="checkbox" className={cn("checkbox", className)} {...props} />;
}

export function Switch({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={cn("switch", className)}
      {...props}
    />
  );
}

// A row with a control on the left and its text on the right.
export function CheckRow({
  control,
  children,
}: {
  control: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field-row">
      {control}
      <span>{children}</span>
    </label>
  );
}

export function ChipToggle({
  children,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className="chip-toggle">
      <input type="checkbox" {...props} />
      {children}
    </label>
  );
}
