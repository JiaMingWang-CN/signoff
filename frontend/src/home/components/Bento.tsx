import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { bento, hashChain } from "../data";
import { gsap, isFinePointer, useGSAP } from "../lib/gsap";
import { Eyebrow } from "./fx";

const levels = ["只读", "逐步审批", "工作区内自动", "完全权限"];
const models = ["gpt-5.1", "deepseek-v4", "qwen3-coder", "glm-5", "kimi-k3"];

function Art({ k }: { k: (typeof bento)[number]["key"] }) {
  switch (k) {
    case "perm":
      return (
        <div className="bt-perm" aria-hidden="true">
          {levels.map((l, i) => (
            <span key={l} style={{ animationDelay: `${i * 1.2}s` }}>
              <i>{i + 1}</i>
              {l}
            </span>
          ))}
        </div>
      );
    case "chain":
      return (
        <div className="bt-chain" aria-hidden="true">
          {hashChain.slice(0, 4).map((h, i) => (
            <span key={h} style={{ animationDelay: `${i * 0.25}s` }}>
              {h.slice(0, 8)}
            </span>
          ))}
        </div>
      );
    case "nl":
      return (
        <div className="bt-nl" aria-hidden="true">
          <span className="serif">“周五不排任务。”</span>
          <span className="bt-nl-diff">
            <i className="del">周五 · #4</i> → <i className="add">下周一 · #4</i>
          </span>
        </div>
      );
    case "local":
      return (
        <code className="bt-local" aria-hidden="true">
          <span>$</span> npm run dev
          <br />
          <em>backend</em> ready :8000
          <br />
          <em>frontend</em> ready :5173
        </code>
      );
    case "llm":
      return (
        <div className="bt-llm" aria-hidden="true">
          <div>
            {[...models, models[0]].map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
      );
  }
}

export default function Bento() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.from(".bt-card", {
        y: 120,
        rotateX: -25,
        opacity: 0,
        duration: 1.3,
        ease: "expo.out",
        stagger: 0.08,
        scrollTrigger: { trigger: ".bt-grid", start: "top 80%" },
      });
      gsap.from(".bt-title .w", {
        yPercent: 110,
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.08,
        scrollTrigger: { trigger: root.current, start: "top 75%" },
      });
    },
    { scope: root },
  );

  // 指针跟随的高光 + 3D 倾斜
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!isFinePointer()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    gsap.to(el, {
      rotateY: (x - 0.5) * 10,
      rotateX: (0.5 - y) * 10,
      duration: 0.6,
      ease: "power3.out",
      transformPerspective: 900,
    });
  };
  const onLeave = (e: ReactPointerEvent<HTMLElement>) =>
    gsap.to(e.currentTarget, { rotateX: 0, rotateY: 0, duration: 1, ease: "elastic.out(1, 0.5)" });

  return (
    <section ref={root} className="bento" id="features">
      <div className="bt-head">
        <Eyebrow no="05">能力</Eyebrow>
        <h2 className="bt-title">
          <span className="mask">
            <span className="w">安全感，</span>
          </span>
          <span className="mask">
            <span className="w">
              是<i className="serif">designed</i>出来的。
            </span>
          </span>
        </h2>
      </div>
      <div className="bt-grid">
        {bento.map((b) => (
          <article
            key={b.key}
            className={"bt-card card-" + b.key}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
          >
            <span className="bt-meta">{b.meta}</span>
            <Art k={b.key} />
            <div className="bt-copy">
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
