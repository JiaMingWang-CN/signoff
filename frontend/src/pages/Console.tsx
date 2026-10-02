import {
  ArrowUp,
  Bot,
  ChevronRight,
  Hand,
  Loader2,
  Plus,
  Square,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  api,
  type ConsoleCall,
  type ConsoleEffort,
  type ConsolePermission,
  type ConsoleTool,
  type Conversation,
} from "../api";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { dateText } from "../lib/utils";
import {
  Badge,
  Button,
  BusyButton,
  Code,
  Dialog,
  Markdown,
  Notice,
  Page,
  PageHeader,
  Select,
} from "../components";

const tiers: [ConsolePermission, string, string][] = [
  ["readonly", "只读", "只查询，不执行任何操作"],
  ["approve", "逐步审批", "每个操作都在对话里等你批准"],
  ["full", "完全权限", "操作直接执行，不再询问"],
];

const efforts: [ConsoleEffort, string][] = [
  ["", "思考：默认"],
  ["low", "思考：低"],
  ["medium", "思考：中"],
  ["high", "思考：高"],
  ["xhigh", "思考：超高"],
  ["max", "思考：最大"],
];

const examples = [
  "当前仓库有多少未关闭的 Issue？最近一次扫描有哪些高危发现？",
  "同步当前仓库，然后开始一次漏洞扫描",
  "根据最新扫描生成规划，并按每天 4 小时排期",
  "列出最近的 Agent 运行，哪些在等我审批？",
];

type Step = { call: ConsoleCall; args: Record<string, unknown>; result?: string };
type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "say"; key: string; text: string }
  | { kind: "work"; key: string; steps: Step[] };

function parse(text: string) {
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function thread(convo: Conversation): Item[] {
  const results = new Map<string, string>();
  for (const m of convo.messages)
    if (m.role === "tool") results.set(m.tool_call_id, m.content);
  const items: Item[] = [];
  convo.messages.forEach((m, i) => {
    const key = "m" + i;
    if (m.role === "user") items.push({ kind: "user", key, text: m.content });
    if (m.role !== "assistant") return;
    if (m.content?.trim()) items.push({ kind: "say", key, text: m.content });
    if (!m.tool_calls?.length) return;
    const steps = m.tool_calls.map((call) => ({
      call,
      args: parse(call.function.arguments),
      result: results.get(call.id),
    }));
    // Consecutive tool rounds form one collapsed block between two messages.
    const last = items.at(-1);
    if (last?.kind === "work") last.steps.push(...steps);
    else items.push({ kind: "work", key: key + "w", steps });
  });
  return items;
}

const argsText = (args: Record<string, unknown>) =>
  Object.values(args)
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(" · ");

function Work({
  steps,
  labels,
  live,
}: {
  steps: Step[];
  labels: Record<string, string>;
  live: boolean;
}) {
  const running = live && steps.some((s) => s.result === undefined);
  const failed = steps.filter((s) => s.result?.startsWith("错误")).length;
  return (
    <details className="chat-work">
      <summary>
        <ChevronRight className="chev" />
        <span>
          调用了 {steps.length} 个工具：
          {[...new Set(steps.map((s) => labels[s.call.function.name] || s.call.function.name))].join("、")}
        </span>
        {failed > 0 && <Badge tone="danger">{failed} 个失败</Badge>}
        {running && <Loader2 className="spin" />}
      </summary>
      <div className="chat-calls">
        {steps.map((s) => (
          <details key={s.call.id} className="chat-call">
            <summary>
              <b>{labels[s.call.function.name] || s.call.function.name}</b>
              <span className="mono ellipsis">{argsText(s.args)}</span>
              {s.result?.startsWith("错误") && <Badge tone="danger">失败</Badge>}
            </summary>
            <pre className="mono small">
              {s.result === undefined ? "执行中…" : prettify(s.result).slice(0, 6000)}
            </pre>
          </details>
        ))}
      </div>
    </details>
  );
}

function prettify(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function Console() {
  const s = useStore();
  const guest = !s.session?.user;
  const [params, setParams] = useSearchParams();
  const id = params.get("c") || "";
  const list = useResource<Conversation[]>("/console/conversations");
  const tools = useResource<ConsoleTool[]>("/console/tools");
  const [running, setRunning] = useState(false);
  const detail = useResource<Conversation>(
    id ? "/console/conversations/" + id : null,
    running ? 1000 : 0,
  );
  // useResource drops its data for a moment whenever the poll interval
  // changes, which would flash the empty state and reset the scroll position;
  // the last conversation received for this id covers that gap.
  const latest = useRef<Conversation | null>(null);
  if (detail.data?.id === id) latest.current = detail.data;
  const convo = id && latest.current?.id === id ? latest.current : null;
  const [text, setText] = useState("");
  const [permission, setPermission] = useState<ConsolePermission>(() =>
    localStorage.getItem("ow-console-permission") === "readonly" ? "readonly" : "approve",
  );
  const [effort, setEffort] = useState<ConsoleEffort>(() => {
    const saved = localStorage.getItem("ow-console-effort");
    return efforts.some(([v]) => v === saved) ? (saved as ConsoleEffort) : "";
  });
  const [fullConfirmed, setFullConfirmed] = useState(false);
  const [askFull, setAskFull] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const labels = Object.fromEntries(
    (tools.data || []).map((t) => [t.name, t.label]),
  );
  const status = convo?.status;
  const items = convo ? thread(convo) : [];
  const pendingStep = convo?.pending.call_id
    ? items
        .flatMap((i) => (i.kind === "work" ? i.steps : []))
        .find((st) => st.call.id === convo.pending.call_id)
    : undefined;
  const activeStep = items
    .flatMap((i) => (i.kind === "work" ? i.steps : []))
    .find((st) => st.result === undefined);

  // Poll while the reply is being written; refresh the rest of the app once
  // it is done, since the console may have imported, scanned or planned.
  useEffect(() => {
    const busy = status === "running";
    if (running && !busy) {
      list.reload();
      s.reload();
    }
    setRunning(busy);
  }, [status]);

  // Opening a conversation adopts the tier it was last used with; full
  // permission is never adopted silently, it is confirmed on this page.
  useEffect(() => {
    if (convo && convo.permission !== "full") {
      setPermission(convo.permission);
      setFullConfirmed(false);
    }
    if (convo) setEffort(convo.effort || "");
  }, [convo?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [convo?.messages.length, status]);

  function choose(value: ConsolePermission) {
    if (value === "full") return setAskFull(true);
    setPermission(value);
    setFullConfirmed(false);
    localStorage.setItem("ow-console-permission", value);
  }

  async function send(message = text) {
    const body = message.trim();
    if (!body) return;
    stick.current = true;
    const result = await s.perform("console-send", () =>
      api<Conversation>("/console/messages", {
        text: body,
        conversation_id: id,
        permission,
        effort,
        full_confirmed: fullConfirmed,
        repo_id: s.repo?.id || "",
      }),
    );
    if (!result) return;
    setText("");
    setRunning(true);
    // The reply to the send already is the conversation: show it at once
    // instead of waiting for the first fetch of a new id.
    latest.current = result;
    if (result.id !== id) setParams({ c: result.id });
    else detail.reload();
    list.reload();
  }

  async function decide(decision: "approve" | "reject" | "always") {
    const result = await s.perform("console-decide", () =>
      api("/console/conversations/" + id + "/decision", { decision }),
    );
    if (result) {
      setRunning(true);
      detail.reload();
    }
  }

  async function stop() {
    await s.perform("console-stop", () =>
      api("/console/conversations/" + id + "/stop", {}),
    );
    detail.reload();
    list.reload();
  }

  const busy = status === "running";
  return (
    <Page>
      <PageHeader
        title="总控台"
        description="用自然语言查询和指挥整个工作台：导入同步、检索、扫描复核、规划排期、Agent 修复、PR、审计与设置。"
      />
      <div className="page-body">
        {detail.error && <Notice error>{detail.error}</Notice>}
        <section className="card flex chat-layout fill-row">
          <aside className="chat-list" aria-label="对话列表">
            <Button
              variant="outline"
              size="sm"
              disabled={!id}
              onClick={() => {
                setParams({});
                setText("");
              }}
            >
              <Plus />
              新对话
            </Button>
            <div className="chat-list-items">
              {list.data?.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={"chat-list-item" + (c.id === id ? " active" : "")}
                  onClick={() => {
                    stick.current = true;
                    setParams({ c: c.id });
                  }}
                >
                  <span className="clamp-2">{c.title || "新对话"}</span>
                  <span className="muted small">
                    {dateText(c.updated)}
                    {c.status === "waiting" && " · 等待批准"}
                    {c.status === "running" && " · 回复中"}
                  </span>
                </button>
              ))}
              {!list.data?.length && <p className="muted small">还没有对话</p>}
            </div>
          </aside>
          <div className="chat">
            <div
              className="chat-scroll"
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {convo ? (
                <div className="chat-thread">
                  {items.map((item) =>
                    item.kind === "user" ? (
                      <div className="chat-row user" key={item.key}>
                        <div className="chat-bubble">{item.text}</div>
                      </div>
                    ) : item.kind === "say" ? (
                      <div className="chat-row agent" key={item.key}>
                        <Bot className="chat-avatar" />
                        <div className="chat-say">
                          <Markdown text={item.text} />
                        </div>
                      </div>
                    ) : (
                      <div className="chat-row agent" key={item.key}>
                        <span className="chat-avatar" />
                        <Work steps={item.steps} labels={labels} live={busy} />
                      </div>
                    ),
                  )}
                  {status === "waiting" && pendingStep && (
                    <div className="chat-row agent">
                      <span className="chat-avatar" />
                      <div className="approval compact">
                        <div className="approval-head">
                          <Hand />
                          <strong>
                            需要批准：
                            {labels[pendingStep.call.function.name] ||
                              pendingStep.call.function.name}
                          </strong>
                        </div>
                        {Object.keys(pendingStep.args).length > 0 && (
                          <Code text={JSON.stringify(pendingStep.args, null, 2)} />
                        )}
                        <div className="actions wrap">
                          <BusyButton
                            label="console-decide"
                            variant="default"
                            size="sm"
                            onClick={() => void decide("approve")}
                          >
                            批准
                          </BusyButton>
                          <BusyButton
                            label="console-decide"
                            size="sm"
                            onClick={() => void decide("reject")}
                          >
                            拒绝
                          </BusyButton>
                          <BusyButton
                            label="console-decide"
                            size="sm"
                            onClick={() => void decide("always")}
                          >
                            本对话内始终允许此操作
                          </BusyButton>
                        </div>
                      </div>
                    </div>
                  )}
                  {busy && (
                    <div className="chat-row agent">
                      <span className="chat-avatar" />
                      <div className="chat-thinking">
                        <Loader2 className="spin" />
                        {activeStep
                          ? "正在执行：" +
                            (labels[activeStep.call.function.name] ||
                              activeStep.call.function.name)
                          : "正在思考…"}
                      </div>
                    </div>
                  )}
                  {convo.error && (
                    <div className="chat-row agent">
                      <span className="chat-avatar" />
                      <div className="chat-note danger">{convo.error}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="chat-empty">
                  <Bot />
                  <h3>想让工作台做什么？</h3>
                  <p className="muted">
                    直接用自然语言提问或下达指令，助手会调用工作台的工具完成，不需要再去其他页面点击。
                    {s.repo ? `未指定仓库时默认操作 ${s.repo.name}。` : ""}
                  </p>
                  <div className="console-examples">
                    {examples.map((e) => (
                      <button
                        type="button"
                        key={e}
                        className="console-example"
                        disabled={!!s.busy}
                        onClick={() => void send(e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="chat-composer">
              <div className="chat-input">
                <textarea
                  className="textarea"
                  aria-label="消息"
                  rows={2}
                  value={text}
                  placeholder={
                    status === "waiting"
                      ? "有操作在等待批准；直接发送新消息等同于拒绝它"
                      : "提问或下达指令，Enter 发送，Shift+Enter 换行"
                  }
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!busy && !s.busy) void send();
                    }
                  }}
                />
                <div className="chat-tools">
                  <Select
                    aria-label="权限"
                    value={permission}
                    title={tiers.find((t) => t[0] === permission)?.[2]}
                    onChange={(e) => choose(e.target.value as ConsolePermission)}
                  >
                    {tiers.map(([value, title]) => (
                      <option key={value} value={value} disabled={value === "full" && guest}>
                        {title}
                        {value === "full" && guest ? "（需登录）" : ""}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="思考强度"
                    value={effort}
                    title="发给模型的 reasoning_effort；默认沿用设置页“问答”的值"
                    onChange={(e) => {
                      const value = e.target.value as ConsoleEffort;
                      setEffort(value);
                      localStorage.setItem("ow-console-effort", value);
                    }}
                  >
                    {efforts.map(([value, title]) => (
                      <option key={value} value={value}>
                        {title}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => setShowTools(true)}>
                    <Wrench />
                    可用工具{tools.data ? "（" + tools.data.length + "）" : ""}
                  </Button>
                  {s.repo && (
                    <span className="muted small ellipsis">当前仓库：{s.repo.name}</span>
                  )}
                  <span className="spacer" />
                  {busy ? (
                    <BusyButton label="console-stop" variant="danger" onClick={() => void stop()}>
                      <Square />
                      停止
                    </BusyButton>
                  ) : (
                    <BusyButton
                      label="console-send"
                      variant="brand"
                      disabled={!text.trim()}
                      onClick={() => void send()}
                    >
                      <ArrowUp />
                      发送
                    </BusyButton>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {showTools && (
        <Dialog
          size="wide"
          title="总控台可用工具"
          description="查询类工具在任何权限下都可用；操作类工具在只读下被拒绝，逐步审批下逐个等你批准，完全权限下直接执行。登录、仓库可见性等限制与页面操作相同。"
          onClose={() => setShowTools(false)}
        >
          {(["read", "write"] as const).map((kind) => (
            <div key={kind} className="stack">
              <h3 className="small">{kind === "read" ? "查询" : "操作"}</h3>
              {tools.data
                ?.filter((t) => t.kind === kind)
                .map((t) => (
                  <div className="tool-row" key={t.name}>
                    <span>
                      <b>{t.label}</b> <span className="mono muted small">{t.name}</span>
                    </span>
                    <span className="muted small console-tool-desc">{t.description}</span>
                  </div>
                ))}
            </div>
          ))}
        </Dialog>
      )}
      {askFull && (
        <Dialog
          title="开启完全权限？"
          footer={
            <>
              <Button variant="outline" onClick={() => setAskFull(false)}>
                取消
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setPermission("full");
                  setFullConfirmed(true);
                  setAskFull(false);
                }}
              >
                确认开启
              </Button>
            </>
          }
          onClose={() => setAskFull(false)}
        >
          <p className="small">
            助手会直接执行导入、扫描、规划、启动 Agent、创建 PR、清空规划、修改设置等操作，不再逐条询问。只对当前页面有效，刷新后恢复为逐步审批。
          </p>
        </Dialog>
      )}
    </Page>
  );
}
