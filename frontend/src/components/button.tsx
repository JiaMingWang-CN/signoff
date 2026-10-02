import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
import { useStore } from "../lib/store";

export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-primary",
      brand: "btn-brand",
      outline: "btn-outline",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      danger: "btn-danger",
      link: "btn-link",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "btn-lg",
      icon: "btn-icon",
      "icon-sm": "btn-icon btn-sm",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// A button tied to the global busy state: while `label` is running it shows a
// spinner, and every BusyButton is disabled so actions never overlap.
export function BusyButton({
  label,
  onClick,
  children,
  disabled = false,
  variant = "outline",
  size,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
} & ButtonVariants) {
  const s = useStore();
  const running = s.busy === label;
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || !!s.busy}
      onClick={onClick}
    >
      {running ? (
        <>
          <Loader2 className="spin" />
          处理中…
        </>
      ) : (
        children
      )}
    </Button>
  );
}
