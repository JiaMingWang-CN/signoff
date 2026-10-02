import { useEffect, useRef, useState } from "react";
import { gsap, isFinePointer } from "../lib/gsap";

// 自定义光标：实心点紧跟指针，外环带惯性；悬停在 [data-cursor] 上时外环展开成文字标签。
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"" | "link" | "label" | "hidden">("");
  const [enabled] = useState(isFinePointer);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add("has-cursor");
    const dx = gsap.quickTo(dot.current, "x", { duration: 0.08, ease: "power3" });
    const dy = gsap.quickTo(dot.current, "y", { duration: 0.08, ease: "power3" });
    const rx = gsap.quickTo(ring.current, "x", { duration: 0.45, ease: "power3" });
    const ry = gsap.quickTo(ring.current, "y", { duration: 0.45, ease: "power3" });
    let shown = false;
    const move = (e: PointerEvent) => {
      if (!shown) {
        shown = true;
        gsap.set([dot.current, ring.current], { x: e.clientX, y: e.clientY });
        gsap.to([dot.current, ring.current], { autoAlpha: 1, duration: 0.3 });
      }
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
    };
    const over = (e: PointerEvent) => {
      const t = e.target as Element | null;
      const tagged = t?.closest?.("[data-cursor]") as HTMLElement | null;
      if (tagged) {
        const v = tagged.dataset.cursor ?? "";
        if (v === "hide") {
          setMode("hidden");
        } else {
          setLabel(v);
          setMode("label");
        }
        return;
      }
      if (t?.closest?.("a, button, [role=button], input, label")) {
        setMode("link");
      } else {
        setMode("");
      }
    };
    const leave = () => {
      shown = false;
      gsap.to([dot.current, ring.current], { autoAlpha: 0, duration: 0.2 });
    };
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerover", over);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={ring} className="cursor-ring" data-mode={mode} aria-hidden="true">
        <span>{label}</span>
      </div>
      <div ref={dot} className="cursor-dot" data-mode={mode} aria-hidden="true" />
    </>
  );
}
