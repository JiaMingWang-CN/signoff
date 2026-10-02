import { useState, type CSSProperties } from "react";
import { diff, findings, hashChain, lanes, searchResults, tasks } from "../data";

// 流程每一步右侧的迷你界面。动画由父级 .is-active 驱动（见 home.css）。

// 交错动画的序号，CSS 里用 calc(var(--i) * …) 计算延迟
const nth = (i: number) => ({ "--i": i }) as CSSProperties;

export function SearchVignette() {
  return (
    <div className="vg vg-search">
      <div className="vg-input">
        <span className="vg-k">⌘K</span>
        <span className="vg-typed">search_notes 的调用方</span>
        <span className="vg-caret" />
      </div>
      <ul className="vg-results">
        {searchResults.map((r, i) => (
          <li key={r.name} style={nth(i)}>
            <span className={"vg-kind kind-" + r.kind}>{r.kind}</span>
            <b>{r.name}</b>
            <span className="vg-dim">
              {r.file}:{r.line}
            </span>
          </li>
        ))}
      </ul>
      <svg className="vg-graph" viewBox="0 0 320 110" aria-hidden="true">
        <path d="M40 55 C 100 55, 110 20, 160 20" />
        <path d="M40 55 C 100 55, 110 90, 160 90" />
        <path d="M160 20 C 210 20, 220 55, 280 55" />
        <path d="M160 90 C 210 90, 220 55, 280 55" />
        <circle cx="40" cy="55" r="6" />
        <circle cx="160" cy="20" r="6" />
        <circle cx="160" cy="90" r="6" />
        <circle cx="280" cy="55" r="9" className="hot" />
        <text x="40" y="80">routes</text>
        <text x="160" y="8">search_notes</text>
        <text x="160" y="108">export_md</text>
        <text x="280" y="84">find_notes</text>
      </svg>
    </div>
  );
}

export function ScanVignette() {
  const count = { critical: 1, high: 4, medium: 11, low: 22 };
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  return (
    <div className="vg vg-scan">
      <div className="vg-sevbar" aria-hidden="true">
        {Object.entries(count).map(([k, v]) => (
          <i key={k} className={"sev-" + k} style={{ flexGrow: v / total }} />
        ))}
      </div>
      <div className="vg-sevlegend">
        {Object.entries(count).map(([k, v]) => (
          <span key={k}>
            <i className={"sev-" + k} />
            {k} <b>{v}</b>
          </span>
        ))}
      </div>
      <ul className="vg-findings">
        {findings.map((f, i) => (
          <li key={f.id} style={nth(i)}>
            <span className={"vg-sev sev-" + f.severity}>{f.severity}</span>
            <div>
              <b>{f.title}</b>
              <span className="vg-dim">
                {f.id} · {f.where}
              </span>
            </div>
            <span className={"vg-verdict" + (f.verdict === "确认" ? "" : " is-fp")}>
              LLM：{f.verdict}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssignVignette() {
  const [owners, setOwners] = useState(() => tasks.map((t) => t.owner));
  const hours = (o: "human" | "agent") =>
    tasks.reduce((n, t, i) => n + (owners[i] === o ? t.hours : 0), 0);
  return (
    <div className="vg vg-assign">
      <div className="vg-bubble">
        我把 38 条发现和 247 个 Issue 合并成 5 个任务。每一项由谁来做？点一下就能改。
      </div>
      <ul className="vg-tasks">
        {tasks.map((t, i) => (
          <li key={t.id} style={nth(i)}>
            <span className="vg-dim">P{t.priority}</span>
            <span className="vg-task">{t.title}</span>
            <span className="vg-dim">{t.hours}h</span>
            <button
              type="button"
              className={"vg-toggle is-" + owners[i]}
              aria-label={`任务 ${t.id} 执行方：${owners[i] === "agent" ? "Agent" : "人"}，点击切换`}
              data-cursor="切换"
              onClick={() =>
                setOwners((o) => o.map((v, k) => (k === i ? (v === "agent" ? "human" : "agent") : v)))
              }
            >
              <span>人</span>
              <span>Agent</span>
              <i />
            </button>
          </li>
        ))}
      </ul>
      <div className="vg-sum">
        <span>
          <i className="dot-human" />人 {hours("human")}h
        </span>
        <span>
          <i className="dot-agent" />
          Agent {hours("agent")}h
        </span>
      </div>
    </div>
  );
}

const days = ["一", "二", "三", "四", "五", "一", "二", "三", "四", "五"];

export function PlanVignette() {
  return (
    <div className="vg vg-plan">
      <div className="vg-cal">
        <div className="vg-cal-head">
          <span />
          {days.map((d, i) => (
            <span key={i} className={i === 4 ? "is-blocked" : ""}>
              {d}
            </span>
          ))}
        </div>
        {(["human", "agent"] as const).map((lane) => (
          <div key={lane} className={"vg-lane lane-" + lane}>
            <span className="vg-lane-name">{lane === "human" ? "人" : "Agent"}</span>
            <div className="vg-lane-track">
              <i className="vg-block" style={{ gridColumn: "5 / span 1" }} />
              {lanes[lane].map((b, i) => (
                <span
                  key={b.task}
                  className="vg-bar"
                  style={{
                    ...nth(i + (lane === "agent" ? 2 : 0)),
                    gridColumn: `${b.start + 1} / span ${b.span}`,
                  }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="vg-chat">
        <span className="vg-me">周五不排任务，#4 推到下周一</span>
        <span className="vg-diffnote">
          预览：<b>移动 1</b> · <b>封锁 1 天</b> · 依赖不受影响
        </span>
      </div>
    </div>
  );
}

export function RunVignette() {
  return (
    <div className="vg vg-run">
      <div className="vg-term">
        <div className="vg-term-bar">
          <i />
          <i />
          <i />
          <span>owb/r-7f3a — worktree</span>
        </div>
        <pre className="vg-diff">
          {diff.map((d, i) => (
            <span key={i} className={"d-" + d.t} style={nth(i)}>
              <em>{d.t === "add" ? "+" : d.t === "del" ? "−" : " "}</em>
              {d.s}
            </span>
          ))}
        </pre>
        <div className="vg-approve">
          <span>
            需要审批 · <code>pytest -q tests/test_store.py</code>
          </span>
          <span className="vg-approve-btn">批准</span>
        </div>
        <div className="vg-pass">✓ 17 passed in 2.31s</div>
      </div>
    </div>
  );
}

export function ShipVignette() {
  return (
    <div className="vg vg-ship">
      <div className="vg-pr">
        <div className="vg-pr-head">
          <span className="vg-pr-state">Ready</span>
          <b>fix(store): 参数化查询，修复 SQL 注入</b>
          <span className="vg-dim">owb/r-7f3a → main · +2 −2</span>
        </div>
        <ul className="vg-checks">
          {["测试命令 pytest：17 passed", "diff 与运行记录一致", "事件哈希链：校验通过"].map((c, i) => (
            <li key={c} style={nth(i)}>
              <span className="vg-check">✓</span>
              {c}
            </li>
          ))}
        </ul>
        <div className="vg-chain" aria-hidden="true">
          {hashChain.slice(0, 5).map((h, i) => (
            <span key={h} style={nth(i)}>
              {h.slice(0, 6)}
            </span>
          ))}
        </div>
        <span className="vg-pr-btn" data-cursor="由你决定">
          由我确认并创建 PR
        </span>
      </div>
    </div>
  );
}

export const vignettes = {
  search: SearchVignette,
  scan: ScanVignette,
  assign: AssignVignette,
  plan: PlanVignette,
  run: RunVignette,
  ship: ShipVignette,
};
