import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import LoaderField, { type FieldFx } from "./LoaderField";

const beats = [0, 0.85, 1.7, 2.55];
const EXIT = 3.25;
const words = [
  { title: "读懂", caption: "READ THE CODE", detail: "理解代码与问题" },
  { title: "修复", caption: "MAKE IT WORK", detail: "让 Agent 动手" },
  { title: "交付", caption: "SHIP THE PR", detail: "由你确认，才提交" },
];
const stageNames = ["read", "fix", "ship", "ready"] as const;
const files = [
  ["src/auth/token.ts", 42], ["src/auth/session.ts", 31], ["src/api/client.ts", 57],
  ["src/api/routes.ts", 88], ["src/core/cache.ts", 23], ["src/core/queue.ts", 46],
  ["src/db/schema.ts", 112], ["src/db/migrate.ts", 19], ["src/ui/table.tsx", 64],
  ["src/ui/dialog.tsx", 27], ["test/auth.spec.ts", 38], ["test/cache.spec.ts", 21],
] as const;
const code = [
  "export async function resolveToken(id) {",
  "  const token = await store.get(id);",
  "  if (token) return cache[id];",
  "  return refresh(id, { retry: 3 });",
  "}",
  "",
  "issue #412  token 过期后仍命中缓存",
  "graph  resolveToken → cache → session",
  "scan   CVE-2026-1182  severity: high",
  "",
  "describe(\"resolveToken\", () => {",
  "  it(\"drops expired tokens\", async () => {",
  "    expect(await resolve(stale)).toBe(null);",
  "  });",
  "});",
];
const diff = [
  { s: " ", t: "const token = await store.get(id);" },
  { s: "-", t: "if (token) return cache[id];" },
  { s: "+", t: "if (token && !token.expired)" },
  { s: "+", t: "  return cache[id];" },
];
const chips = [
  { text: "✓ 17 passed", cls: "is-ok" },
  { text: "PR #128 · ready", cls: "" },
  { text: "+3 −1 · 1 file", cls: "is-dim" },
];

// 逐字遮罩，终章标题逐字升起用。
function Chars({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span className="ld-mask" key={i}>
          <span className="ld-ch">{c}</span>
        </span>
      ))}
    </>
  );
}

// 品牌开场进度，不代表后台任务的真实进度。
export default function Loader({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const fx = useRef<FieldFx>({ energy: 0, flood: 0, ring: 0, ringAmp: 0 });
  const [stage, setStage] = useState(0);
  const [gone, setGone] = useState(false);

  useGSAP(() => {
    const [b0, b1, b2, b3] = beats;
    const stages = gsap.utils.toArray<HTMLElement>(".ld-stage", root.current);
    const f = fx.current;
    const progress = { value: 0 };
    const burst = (at: number, amp: number) => {
      tl.fromTo(f, { ring: 0, ringAmp: amp }, { ring: 1.5, ringAmp: 0, duration: 0.9, ease: "power2.out", immediateRender: false }, at);
      tl.fromTo(".ld-shake", { scale: 1.035 }, { scale: 1, duration: 0.5, ease: "expo.out", immediateRender: false }, at);
    };
    const tl = gsap.timeline();

    // 全程：进度、相位条、HUD
    tl.to(progress, {
      value: 100, duration: 3.1, ease: "none",
      onUpdate: () => {
        // 卸载时 useGSAP 回滚时间轴会再触发一次 onUpdate，此时节点已被 React 摘掉。
        if (countRef.current) countRef.current.textContent = String(Math.round(progress.value)).padStart(3, "0");
      },
    }, 0)
      .fromTo(".ld-progress i", { scaleX: 0 }, { scaleX: 1, duration: 3.1, ease: "none" }, 0)
      .fromTo(".ld-meta, .ld-bottom, .ld-frame", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0)
      .to(f, { energy: 0.6, duration: 0.7, ease: "power2.out" }, 0);
    gsap.utils.toArray<HTMLElement>(".ld-phase-track i", root.current).forEach((el, i) => {
      tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: beats[i + 1] - beats[i], ease: "none" }, beats[i]);
    });
    beats.forEach((at, i) => tl.call(() => setStage(i), undefined, at));

    // 01 读懂：字从 1.65 倍砸下，轮廓回声向外扩散；两侧是被扫描的文件与代码
    burst(b0, 1);
    tl.set(stages[0], { autoAlpha: 1 }, b0)
      .fromTo(".ld-stage-0 .ld-solid", { scale: 1.65, rotation: -6, filter: "blur(18px)" }, {
        scale: 1, rotation: 0, filter: "blur(0px)", duration: 0.5, ease: "power4.out",
      }, b0)
      .fromTo(".ld-stage-0 .ld-echo", { scale: 0.92, opacity: 0.7 }, {
        scale: (i: number) => 1.14 + i * 0.16, opacity: 0, duration: 0.8, stagger: 0.05, ease: "expo.out",
      }, b0 + 0.05)
      .fromTo(".ld-stage-0 .ld-stage-top, .ld-stage-0 .ld-stage-detail", { opacity: 0, y: 14 }, {
        opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: "power3.out",
      }, b0 + 0.15)
      .fromTo(".ld-side", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, b0 + 0.05)
      .fromTo(".ld-side-track", { yPercent: 0 }, { yPercent: -50, duration: b1 + 0.2, ease: "none" }, b0)
      .fromTo(".ld-file", { opacity: 0.25 }, { opacity: 1, duration: 0.08, stagger: 0.06 }, b0 + 0.1)
      .fromTo(".ld-scan", { top: "-10%" }, { top: "110%", duration: 0.8, ease: "power1.inOut" }, b0 + 0.05);

    // 02 修复：抖动橙幕从中心炸开，字被横向切成三片再咬合
    tl.to(f, { flood: 1.45, duration: 0.45, ease: "expo.out" }, b1 - 0.15)
      .set([stages[0], ".ld-side"], { autoAlpha: 0 }, b1)
      .set(stages[1], { autoAlpha: 1 }, b1)
      .fromTo(".ld-stage-1 .ld-slice", { x: (i: number) => ["-22vw", "16vw", "-9vw"][i], skewX: -14 }, {
        x: 0, skewX: 0, duration: 0.45, ease: "expo.out", stagger: 0.03,
      }, b1)
      .fromTo(".ld-stage-1 .ld-stage-top, .ld-stage-1 .ld-stage-detail", { opacity: 0, y: 14 }, {
        opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: "power3.out",
      }, b1 + 0.1)
      .fromTo(".ld-diff", { autoAlpha: 0, x: 60, rotation: 3 }, {
        autoAlpha: 1, x: 0, rotation: 0, duration: 0.45, ease: "expo.out",
      }, b1 + 0.12)
      .fromTo(".ld-diff-line", { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.2, stagger: 0.07 }, b1 + 0.2)
      .fromTo(".ld-diff-line.is-del", { "--strike": 0 }, { "--strike": 1, duration: 0.25, ease: "power2.inOut" }, b1 + 0.45);
    burst(b1, 0.6);

    // 03 交付：橙幕收回中心，冲击波再起；字从下方甩上来，测试结果弹出，批准章砸下
    tl.to(f, { flood: 0, duration: 0.25, ease: "power3.in" }, b2 - 0.15)
      .set([stages[1], ".ld-diff"], { autoAlpha: 0 }, b2)
      .set(stages[2], { autoAlpha: 1 }, b2)
      .fromTo(".ld-stage-2 .ld-solid", { yPercent: 90, rotation: 8 }, {
        yPercent: 0, rotation: 0, duration: 0.45, ease: "circ.out",
      }, b2)
      .fromTo(".ld-stage-2 .ld-stage-top, .ld-stage-2 .ld-stage-detail", { opacity: 0, y: 14 }, {
        opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: "power3.out",
      }, b2 + 0.1)
      .fromTo(".ld-chip", { scale: 0, rotation: -12 }, {
        scale: 1, rotation: 0, duration: 0.5, stagger: 0.07, ease: "back.out(2.2)",
      }, b2 + 0.12)
      .fromTo(".ld-stamp", { autoAlpha: 0, scale: 2.6, rotation: -28 }, {
        autoAlpha: 1, scale: 1, rotation: -9, duration: 0.22, ease: "power4.in",
      }, b2 + 0.3)
      .fromTo(".ld-stage-2 .ld-verb", { x: 0, y: 0 }, {
        keyframes: { x: [7, -5, 3, 0], y: [-4, 3, -1, 0] }, duration: 0.24, ease: "none",
      }, b2 + 0.52);
    burst(b2, 0.9);

    // 终章：品牌字逐字升起，噪声场冲到满格，然后整幕升起交给首屏
    tl.set(stages[2], { autoAlpha: 0 }, b3)
      .set(".ld-finale", { autoAlpha: 1 }, b3)
      .fromTo(".ld-finale .ld-ch", { yPercent: 115 }, {
        yPercent: 0, duration: 0.7, stagger: 0.025, ease: "expo.out",
      }, b3)
      .fromTo(".ld-finale-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.inOut" }, b3 + 0.1)
      .fromTo(".ld-finale p", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 }, b3 + 0.25)
      .to(f, { energy: 1.15, duration: 0.5, ease: "power2.out" }, b3);
    burst(b3, 1.3);

    tl.to(".ld-meta, .ld-bottom, .ld-frame", { opacity: 0, duration: 0.2 }, EXIT - 0.05)
      .add(onDone, EXIT)
      .to(root.current, { yPercent: -100, duration: 0.8, ease: "expo.inOut" }, EXIT)
      .add(() => setGone(true));
  }, { scope: root });

  if (gone) return null;
  return (
    <div ref={root} className="loader" data-stage={stageNames[stage]} role="status" aria-label="正在载入">
      <LoaderField fx={fx} />
      <div className="ld-scan" aria-hidden="true" />
      <div className="grain ld-grain" aria-hidden="true" />

      <div className="ld-frame" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <div className="ld-meta" aria-hidden="true">
        <span>SIGN<i>/</i>OFF</span>
        <span className="ld-meta-mid">(00) LLM-native 开源维护工作台</span>
        <span>开场演示 / INTRO</span>
      </div>

      <div className="ld-side ld-side-l" aria-hidden="true">
        <div className="ld-side-head">INDEX · codegraph</div>
        <div className="ld-side-win">
          <div className="ld-side-track">
            {[0, 1].map((k) => files.map(([path, n]) => (
              <div className="ld-file" key={k + path}><span>{path}</span><b>✓ {n}</b></div>
            )))}
          </div>
        </div>
      </div>
      <div className="ld-side ld-side-r" aria-hidden="true">
        <div className="ld-side-head">READ · src/auth/token.ts</div>
        <div className="ld-side-win">
          <div className="ld-side-track">
            {[0, 1].map((k) => code.map((line, i) => (
              <div className="ld-code" key={k + "-" + i}><span>{String(40 + i).padStart(3, " ")}</span>{line || " "}</div>
            )))}
          </div>
        </div>
      </div>

      <div className="ld-shake" aria-hidden="true">
        {words.map((word, i) => (
          <div className={`ld-stage ld-stage-${i}`} key={word.title}>
            <div className="ld-stage-top"><span>0{i + 1} / 03</span>{word.caption}</div>
            <div className="ld-verb">
              {i === 0 && [0, 1, 2, 3].map((n) => <span className="ld-echo" key={n}>{word.title}.</span>)}
              {i === 1
                ? [0, 1, 2].map((n) => (
                    <span className={`ld-slice ld-slice-${n}`} key={n}>{word.title}<i className="serif">.</i></span>
                  ))
                : <span className="ld-solid">{word.title}<i className="serif">.</i></span>}
              {i === 2 && (
                <>
                  <span className="ld-stamp serif">approved.</span>
                  <div className="ld-chips">
                    {chips.map((c) => <span className={`ld-chip ${c.cls}`} key={c.text}>{c.text}</span>)}
                  </div>
                </>
              )}
            </div>
            <div className="ld-stage-detail">{word.detail}</div>
          </div>
        ))}

        <div className="ld-diff">
          <div className="ld-diff-head"><span>src/auth/token.ts</span><span>@@ -42,2 +42,3 @@</span></div>
          {diff.map((d, i) => (
            <div className={`ld-diff-line${d.s === "-" ? " is-del" : d.s === "+" ? " is-add" : ""}`} key={i}>
              <span>{d.s}</span><code>{d.t}</code>
            </div>
          ))}
        </div>

        <div className="ld-finale">
          <div className="ld-finale-ln"><Chars text="Sign" /><i className="serif"><Chars text="/" /></i></div>
          <div className="ld-finale-ln ld-finale-ln-2"><Chars text="off" /><span className="ld-dot"><Chars text="." /></span></div>
          <div className="ld-finale-rule" />
          <p>从读懂代码，到提交 PR。每一步，都由你掌控。</p>
        </div>
      </div>

      <div className="ld-bottom" aria-hidden="true">
        <div className="ld-phases">
          {words.map((w, i) => (
            <div className={`ld-phase${stage === i ? " is-current" : stage > i ? " is-done" : ""}`} key={w.title}>
              <div><span>0{i + 1}</span>{w.title}<em>{stage > i ? "✓" : ""}</em></div>
              <div className="ld-phase-track"><i /></div>
            </div>
          ))}
        </div>
        <div className="ld-progress"><i /></div>
        <div className="ld-count"><span ref={countRef}>000</span><sup>%</sup></div>
      </div>
    </div>
  );
}
