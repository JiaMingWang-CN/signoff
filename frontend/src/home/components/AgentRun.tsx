import { useCallback, useEffect, useRef, useState } from "react";
import { hashChain, runLines } from "../data";
import { gsap, ScrollTrigger, useGSAP } from "../lib/gsap";
import { Eyebrow, Magnetic } from "./fx";

const principles = [
  { k: "独立 worktree", v: "原始代码不受影响，每次运行一个分支。" },
  { k: "逐步审批", v: "写入与命令可以暂停，等你点头；随时可以叫停。" },
  { k: "只认真测试", v: "pytest / npm test / go test 至少跑过一个用例才算通过。" },
];

export default function AgentRun() {
  const root = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [started, setStarted] = useState(false);
  const timer = useRef<number>(0);
  const askAt = runLines.findIndex((l) => l.kind === "ask");
  const done = shown >= runLines.length;

  const next = useCallback(() => {
    setShown((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!started || done) return;
    // 停在审批行，等你点“批准”（或 4 秒后代为批准）
    if (shown === askAt + 1) {
      setWaiting(true);
      timer.current = window.setTimeout(() => {
        setWaiting(false);
        next();
      }, 4000);
    } else {
      timer.current = window.setTimeout(next, shown === 0 ? 300 : 520 + Math.random() * 380);
    }
    return () => clearTimeout(timer.current);
  }, [started, shown, done, askAt, next]);

  const approve = () => {
    clearTimeout(timer.current);
    setWaiting(false);
    next();
  };
  const replay = () => {
    setWaiting(false);
    setShown(0);
  };

  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: ".ar-term",
        start: "top 70%",
        once: true,
        onEnter: () => setStarted(true),
      });
      gsap.from(".ar-title .w", {
        yPercent: 110,
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.08,
        scrollTrigger: { trigger: root.current, start: "top 70%" },
      });
      gsap.from(".ar-pr li", {
        opacity: 0,
        x: -30,
        duration: 1,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: ".ar-pr", start: "top 80%" },
      });
      gsap.from(".ar-term", {
        rotateX: 18,
        rotateY: -14,
        y: 80,
        opacity: 0,
        duration: 1.6,
        ease: "expo.out",
        scrollTrigger: { trigger: ".ar-term", start: "top 85%" },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="agentrun" id="run">
      <div className="ar-left">
        <Eyebrow no="04">运行</Eyebrow>
        <h2 className="ar-title">
          <span className="mask">
            <span className="w">你批准，</span>
          </span>
          <span className="mask">
            <span className="w">
              它才<i className="serif">动手.</i>
            </span>
          </span>
        </h2>
        <ol className="ar-pr">
          {principles.map((p, i) => (
            <li key={p.k}>
              <span>0{i + 1}</span>
              <div>
                <b>{p.k}</b>
                <p>{p.v}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="ar-right">
        <div className="ar-term" data-cursor="运行记录">
          <div className="ar-term-bar">
            <i />
            <i />
            <i />
            <span>agent · run r-7f3a</span>
            <span className={"ar-state" + (done ? " is-done" : waiting ? " is-wait" : "")}>
              {done ? "待审核" : waiting ? "等待审批" : started ? "运行中" : "就绪"}
            </span>
          </div>
          <div className="ar-lines" aria-live="polite">
            {runLines.slice(0, shown).map((l, i) => (
              <div key={i} className={"ar-line k-" + l.kind}>
                <span className="ar-t">{l.t}</span>
                <span className="ar-txt">{l.text}</span>
                {l.kind === "ask" && waiting && i === askAt && (
                  <span className="ar-ask">
                    <Magnetic strength={0.25}>
                      <button type="button" onClick={approve}>
                        批准
                      </button>
                    </Magnetic>
                    <button type="button" className="ghost" onClick={approve}>
                      本次运行都允许
                    </button>
                  </span>
                )}
              </div>
            ))}
            {!done && <span className="ar-caret" aria-hidden="true" />}
          </div>
          {done && (
            <button type="button" className="ar-replay" onClick={replay}>
              ↻ 重放
            </button>
          )}
        </div>

        <div className="ar-chain" aria-label="事件哈希链">
          {hashChain.map((h, i) => {
            const on = shown > i + 1 || done;
            return (
              <div key={h} className={"ar-block" + (on ? " is-on" : "")}>
                <span>#{String(i).padStart(2, "0")}</span>
                <b>{h}</b>
                <em>prev {i ? hashChain[i - 1].slice(0, 6) : "000000"}</em>
              </div>
            );
          })}
          <div className={"ar-verified" + (done ? " is-on" : "")}>SHA-256 链校验通过</div>
        </div>
      </div>
    </section>
  );
}
