import { useRef } from "react";
import { repo, stats } from "../data";
import { gsap, useGSAP } from "../lib/gsap";
import { Odometer } from "./fx";

export default function Stats() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.from(".st-cell", {
        clipPath: "inset(100% 0 0 0)",
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.1,
        scrollTrigger: { trigger: root.current, start: "top 80%" },
      });
    },
    { scope: root },
  );
  return (
    <section ref={root} className="numbers" aria-label="示例仓库数据">
      <div className="st-head">
        <span>{repo.name}</span>
        <span>示意数据 · 非你的仓库</span>
      </div>
      <div className="st-grid">
        {stats.map((s, i) => (
          <div key={s.label} className="st-cell">
            <span className="st-idx">0{i + 1}</span>
            <Odometer value={s.value} suffix={s.suffix} />
            <span className="st-label">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
