import { useRef } from "react";
import { useResource } from "../../lib/resource";
import { useStore } from "../../lib/store";
import { useEnterDemo } from "../lib/demo";
import { gsap, SplitText, useGSAP } from "../lib/gsap";
import { scrollToTop } from "../lib/lenis";
import { Magnetic, RollLink } from "./fx";

type Health = { status: string; codegraph: { available: boolean; version: string } };

const cols = [
  {
    h: "产品",
    items: [
      { text: "检索", to: "/search" },
      { text: "漏洞扫描", to: "/security" },
      { text: "规划与日历", to: "/planning" },
      { text: "Agent 运行", to: "/runs" },
    ],
  },
  {
    h: "开始",
    items: [
      { text: "导入仓库", to: "/repos" },
      { text: "GitHub 登录", href: "/api/auth/github/login" },
      { text: "设置模型", to: "/settings" },
    ],
  },
];

export default function Outro() {
  const root = useRef<HTMLElement>(null);
  const s = useStore();
  const demo = useEnterDemo();
  const health = useResource<Health>("/health");
  const cg = health.data?.codegraph;
  const status = [
    { ok: health.data?.status === "ok", text: health.data ? "后端服务" : "后端未连接" },
    { ok: !!cg?.available, text: cg?.available ? `codegraph ${cg.version}` : "codegraph 不可用" },
    { ok: !!s.settings?.llm_configured, text: s.settings?.llm_configured ? "模型已配置" : "模型未配置" },
  ];

  useGSAP(
    () => {
      // 橙色幕布从中心以圆形展开
      gsap.fromTo(
        ".oc-stage",
        { clipPath: "circle(6% at 50% 60%)" },
        {
          clipPath: "circle(120% at 50% 60%)",
          ease: "none",
          scrollTrigger: { trigger: ".oc", start: "top 85%", end: "top 5%", scrub: 0.6 },
        },
      );
      const split = SplitText.create(".oc-big", { type: "chars", mask: "chars" });
      gsap.from(split.chars, {
        yPercent: 120,
        rotate: 8,
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.03,
        scrollTrigger: { trigger: ".oc", start: "top 30%" },
      });
      gsap.fromTo(
        ".ft-word",
        { yPercent: 60 },
        {
          yPercent: 0,
          ease: "none",
          scrollTrigger: { trigger: ".ft", start: "top bottom", end: "bottom bottom", scrub: true },
        },
      );
    },
    { scope: root },
  );

  return (
    <section ref={root} className="outro">
      <div className="oc">
        <div className="oc-stage">
          <span className="oc-eyebrow">(06) 现在开始</span>
          <h2 className="oc-big" aria-label="把维护，交给链路。">
            <span aria-hidden="true">把维护，</span>
            <span aria-hidden="true">
              交给<i className="serif">链路.</i>
            </span>
          </h2>
          <div className="oc-row">
            <p>
              无需登录即可在示例仓库{s.session?.demo_repo ? ` ${s.session.demo_repo} ` : ""}上体验检索、扫描、规划与测试运行。创建 PR 需要 GitHub 登录，并且永远由你确认。
            </p>
            <Magnetic strength={0.45}>
              <button
                type="button"
                className="oc-btn"
                data-cursor="出发"
                disabled={demo.disabled}
                onClick={() => void demo.enter()}
              >
                <span>{demo.busy ? "正在导入…" : "体验示例仓库"}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </Magnetic>
          </div>
        </div>
      </div>

      <footer className="ft">
        <div className="ft-cols">
          <div className="ft-about">
            <span className="ft-brand">
              Sign<em>/</em>off
            </span>
            <p>本地运行的开源维护工作台。读懂代码、发现问题、排期、执行、审核——一条可追溯的链路。</p>
          </div>
          {cols.map((c) => (
            <div key={c.h} className="ft-col">
              <span className="ft-h">{c.h}</span>
              {c.items.map((it) =>
                "to" in it ? (
                  <RollLink key={it.text} to={it.to} text={it.text} />
                ) : (
                  <RollLink key={it.text} href={it.href} text={it.text} />
                ),
              )}
            </div>
          ))}
          <div className="ft-col">
            <span className="ft-h">状态</span>
            {status.map((x) => (
              <span key={x.text} className={"ft-status" + (x.ok ? "" : " is-off")}>
                <i /> {x.text}
              </span>
            ))}
          </div>
        </div>
        <div className="ft-bottom">
          <span>© 2026 Signoff</span>
          <button
            type="button"
            className="ft-top"
            onClick={scrollToTop}
          >
            回到顶部 ↑
          </button>
        </div>
        <div className="ft-word" aria-hidden="true">
          SIGNOFF
        </div>
      </footer>
    </section>
  );
}
