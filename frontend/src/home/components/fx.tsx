import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { gsap, isFinePointer, useGSAP } from "../lib/gsap";

// 磁吸：子元素在悬停范围内被指针牵引，离开时弹性回位。
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !isFinePointer()) return;
    const inner = el.firstElementChild as HTMLElement;
    const xTo = gsap.quickTo(inner, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const yTo = gsap.quickTo(inner, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);
  return (
    <div ref={ref} className={"magnetic " + (className ?? "")}>
      {children}
    </div>
  );
}

// 文字滚动悬停：两层相同文本，悬停时逐字错位上翻。
export function Roll({ text }: { text: string }) {
  const chars = [...text];
  const row = (hidden?: boolean) => (
    <span className="roll-row" aria-hidden={hidden || undefined}>
      {chars.map((c, i) => (
        <span key={i} style={{ transitionDelay: `${i * 18}ms` }}>
          {c === " " ? " " : c}
        </span>
      ))}
    </span>
  );
  return (
    <span className="roll" aria-label={text}>
      {row(true)}
      {row(true)}
    </span>
  );
}

export function RollLink({
  to,
  href,
  text,
  className,
  ...rest
}: { to?: string; href?: string; text: string; className?: string } & Omit<
  ComponentPropsWithoutRef<"a">,
  "href" | "children"
>) {
  const cls = "roll-link " + (className ?? "");
  if (to)
    return (
      <Link to={to} className={cls} {...rest}>
        <Roll text={text} />
      </Link>
    );
  return (
    <a href={href} className={cls} {...rest}>
      <Roll text={text} />
    </a>
  );
}

// 里程表式数字：每一位是一列 0–9，进入视口时滚到目标值。
export function Odometer({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const digits = value.toLocaleString("en-US").split("");
  useGSAP(
    () => {
      const cols = gsap.utils.toArray<HTMLElement>(".odo-col", ref.current);
      cols.forEach((col, i) => {
        const d = Number(col.dataset.d);
        gsap.fromTo(
          col,
          { yPercent: 0 },
          {
            yPercent: -(d + 10) * (100 / 20),
            duration: 2.2 + i * 0.12,
            ease: "expo.out",
            scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
          },
        );
      });
    },
    { scope: ref },
  );
  return (
    <span ref={ref} className="odo" aria-label={digits.join("") + suffix}>
      {digits.map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="odo-slot" aria-hidden="true">
            <span className="odo-col" data-d={ch}>
              {Array.from({ length: 20 }, (_, n) => (
                <span key={n}>{n % 10}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="odo-sep" aria-hidden="true">
            {ch}
          </span>
        ),
      )}
      {suffix && (
        <span className="odo-sep" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
}

// 带标签的段落标题行：(02) ——— 名称
export function Eyebrow({ no, children }: { no: string; children: ReactNode }) {
  return (
    <div className="eyebrow">
      <span className="eyebrow-no">({no})</span>
      <span className="eyebrow-line" />
      <span>{children}</span>
    </div>
  );
}

