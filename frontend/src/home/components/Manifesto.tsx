import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "../lib/gsap";
import { Eyebrow } from "./fx";

// 宣言段：随滚动逐字点亮，中间嵌着会弹出的小芯片。
const parts: (string | { chip: string; tone: string })[] = [
  "维护开源项目，不该是在十几个标签页之间来回切换。我们把读代码",
  { chip: "codegraph", tone: "a" },
  "、找漏洞",
  { chip: "CVE-2026-1182", tone: "d" },
  "、排期",
  { chip: "人 / Agent", tone: "b" },
  "、修复、测试",
  { chip: "17 passed", tone: "c" },
  "与提交 PR 收进同一条链路——Agent 负责动手，你负责拍板，每一步都留下可以校验的记录。",
];

export default function Manifesto() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const split = SplitText.create(".mf-text .mf-seg", { type: "chars", charsClass: "mf-ch" });
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: ".mf-text",
          start: "top 78%",
          end: "bottom 45%",
          scrub: 0.6,
        },
      });
      tl.fromTo(
        split.chars,
        { opacity: 0.12 },
        { opacity: 1, stagger: 0.02, ease: "none", duration: 0.3 },
      );
      gsap.utils.toArray<HTMLElement>(".mf-chip", root.current).forEach((chip) => {
        gsap.from(chip, {
          scale: 0,
          rotate: -12,
          ease: "back.out(2.2)",
          duration: 0.8,
          scrollTrigger: { trigger: chip, start: "top 70%", toggleActions: "play none none reverse" },
        });
      });
      gsap.from(".mf-side > *", {
        opacity: 0,
        y: 30,
        stagger: 0.1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: { trigger: root.current, start: "top 70%" },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="manifesto">
      <Eyebrow no="01">为什么</Eyebrow>
      <div className="mf-grid">
        <p className="mf-text">
          {parts.map((p, i) =>
            typeof p === "string" ? (
              <span key={i} className="mf-seg">
                {p}
              </span>
            ) : (
              <span key={i} className={"mf-chip tone-" + p.tone}>
                {p.chip}
              </span>
            ),
          )}
        </p>
        <aside className="mf-side">
          <p>
            不是又一个聊天框。它真的会 clone 你的仓库、建索引、跑扫描、在独立 worktree 里改代码——
            而所有越界的动作，都要先经过你。
          </p>
          <span className="mf-sign serif">— built for maintainers</span>
        </aside>
      </div>
    </section>
  );
}
