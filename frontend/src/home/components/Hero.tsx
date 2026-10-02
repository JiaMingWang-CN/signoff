import { useEffect, useRef, useState } from "react";
import { heroVerbs } from "../data";
import { gsap, SplitText, useGSAP } from "../lib/gsap";
import { useEnterDemo } from "../lib/demo";
import { Magnetic } from "./fx";

// 「Agent 正在 [扫描] 你的仓库」——动词像老虎机一样纵向轮换。
function VerbSlot() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % heroVerbs.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="verb-slot" aria-live="polite">
      <span className="verb-track" style={{ transform: `translateY(${-i * 1.75}em)` }}>
        {heroVerbs.map((v) => (
          <span key={v}>{v}</span>
        ))}
      </span>
    </span>
  );
}

export default function Hero({ ready }: { ready: boolean }) {
  const root = useRef<HTMLElement>(null);
  const demo = useEnterDemo();

  useGSAP(
    () => {
      const split = SplitText.create(".hero-title .ln", {
        type: "chars",
        mask: "chars",
        charsClass: "ch",
      });
      gsap.set(split.chars, { yPercent: 110 });
      gsap.set(".hero-fade", { opacity: 0, y: 24 });
      gsap.set(".hero-rule", { scaleX: 0 });
      if (!ready) return;

      const tl = gsap.timeline({ delay: 0.15 });
      tl.to(split.chars, {
        yPercent: 0,
        duration: 1.3,
        ease: "expo.out",
        stagger: { each: 0.035, from: "start" },
      })
        .to(".hero-rule", { scaleX: 1, duration: 1.4, ease: "expo.inOut" }, 0.2)
        .to(".hero-fade", { opacity: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.08 }, 0.6);

      // 滚动离场：标题放大、模糊、淡出，像被推入屏幕深处
      gsap.to(".hero-title", {
        scale: 1.08,
        yPercent: -18,
        filter: "blur(10px)",
        opacity: 0.1,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
      });
      gsap.to(".hero-foot", {
        yPercent: 80,
        opacity: 0,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: "60% top", scrub: true },
      });
    },
    { scope: root, dependencies: [ready] },
  );

  return (
    <section ref={root} className="hero" id="top">
      <div className="hero-veil" aria-hidden="true" />

      <div className="hero-top hero-fade">
        <span>(00)</span>
        <span>LLM-native 开源维护工作台</span>
        {/* 规格卡：取景框四角 + 顶部抖动像素带，与首屏背景同一套语言 */}
        <aside className="hero-model" aria-label="推荐驱动模型">
          <div className="hero-model-label">
            <span><i aria-hidden="true" />推荐驱动模型</span>
            <span className="hero-model-preview">PREVIEW</span>
          </div>
          <a
            className="hero-model-name"
            href="https://atria-asi.ai/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="了解推荐模型 Atria Dawn Preview（新窗口）"
          >
            <span>Atria <i className="serif">Dawn</i></span>
            <span className="hero-model-arrow" aria-hidden="true">↗</span>
          </a>
          <p>面向代码理解、任务规划与工具执行。</p>
          <dl className="hero-model-meta">
            <div><dt>上下文</dt><dd>256K</dd></div>
            <div><dt>权重</dt><dd>开放</dd></div>
            <div><dt>模态</dt><dd>文本</dd></div>
          </dl>
        </aside>
      </div>

      <h1 className="hero-title" aria-label="从读懂代码，到提交 PR">
        <span className="ln" aria-hidden="true">
          从读懂代码
        </span>
        <span className="ln ln-2" aria-hidden="true">
          到提交<i className="serif">PR.</i>
        </span>
      </h1>

      <div className="hero-rule" aria-hidden="true" />

      <div className="hero-foot">
        <p className="hero-lede hero-fade">
          Agent 正在 <VerbSlot /> 你的仓库。
          <br />
          检索代码与 Issue、扫描漏洞、和你商量分工后排进日历，在你批准的权限里修改代码、跑测试——最后由你按下创建 PR。
        </p>
        <div className="hero-actions hero-fade">
          <Magnetic>
            <button
              type="button"
              className="btn-pill btn-accent"
              data-cursor="开始"
              disabled={demo.disabled}
              onClick={() => void demo.enter()}
            >
              <span>{demo.busy ? "正在导入示例仓库…" : "体验示例仓库"}</span>
              <span className="btn-arrow" aria-hidden="true">
                {demo.busy ? "⟳" : "→"}
              </span>
            </button>
          </Magnetic>
          <Magnetic>
            <a href="/api/auth/github/login" className="btn-pill btn-line">
              <span>GitHub 登录</span>
            </a>
          </Magnetic>
        </div>
        <div className="hero-scroll hero-fade" aria-hidden="true">
          <span>SCROLL</span>
          <i />
        </div>
      </div>
    </section>
  );
}
