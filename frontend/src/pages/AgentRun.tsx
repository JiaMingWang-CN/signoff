import {
  ArrowUp,
  Bot,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Hand,
  Loader2,
  Plus,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  api,
  type Plan,
  type Run,
  type RunConfig,
  type RunEvent,
} from "../api";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { dateText, isActive, statusText, statusTone } from "../lib/utils";
import {
  Alert,
  Badge,
  Button,
  BusyButton,
  buttonVariants,
  Code,
  DiffView,
  Dialog,
  Field,
  Input,
  Markdown,
  Notice,
  Page,
  PageHeader,
  Select,
} from "../components";

const toolNames = [
  "read",
  "search_code",
  "list_files",
  "git_diff",
  "run_tests",
  "write",
  "edit",
  "bash",
];
type AgentView =
  | { kind: "tools" }
  | { kind: "advanced" }
  | { kind: "args"; tool: string; data: unknown };

const presets = [
  ["readonly", "只读"],
  ["approve", "逐步审批"],
  ["auto", "工作区内自动"],
  ["full", "完全权限"],
];

// ── Turning the run's event log into a conversation ──────────────────

type Call = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  done: boolean;
};
type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "say"; key: string; text: string }
  | { kind: "work"; key: string; calls: Call[] }
  | {
      kind: "note";
      key: string;
      tone: "warning" | "danger" | "info";
      text: string;
      url?: string;
    };

function conversation(events: RunEvent[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, Call>();
  // Consecutive tool calls form one collapsed block between two messages.
  const block = (key: string) => {
    const last = items.at(-1);
    if (last?.kind === "work") return last;
    const created: Extract<Item, { kind: "work" }> = {
      kind: "work",
      key,
      calls: [],
    };
    items.push(created);
    return created;
  };
  for (const e of events) {
    const d = e.data;
    const key = "e" + e.id;
    if (e.kind === "user_message") {
      items.push({ kind: "user", key, text: String(d.text) });
    } else if (e.kind === "llm") {
      const text = String(d.text || "").trim();
      if (text) items.push({ kind: "say", key, text });
    } else if (e.kind === "tool_call") {
      const call: Call = {
        id: String(d.call_id),
        tool: String(d.tool),
        args: (d.arguments as Record<string, unknown>) || {},
        done: d.permission === "deny",
        result: d.permission === "deny" ? { error: "权限禁止此工具" } : undefined,
      };
      calls.set(call.id, call);
      block(key).calls.push(call);
    } else if (e.kind === "tool_result") {
      const call = calls.get(String(d.call_id));
      if (call) {
        call.result = d.result;
        call.done = true;
      } else {
        // The tests the run itself performs when the model stops.
        block(key).calls.push({
          id: key,
          tool: String(d.tool),
          args: {},
          result: d.result,
          done: true,
        });
      }
    } else if (e.kind === "limit") {
      items.push({ kind: "note", key, tone: "warning", text: "已停止：" + d.reason });
    } else if (e.kind === "error") {
      items.push({ kind: "note", key, tone: "danger", text: String(d.error) });
    } else if (e.kind === "stopped") {
      items.push({ kind: "note", key, tone: "info", text: "运行已停止" });
    } else if (e.kind === "reviewed") {
      items.push({
        kind: "note",
        key,
        tone: "info",
        text: d.decision === "accept" ? "已通过审核" : "已驳回",
      });
    } else if (e.kind === "pr_created") {
      items.push({
        kind: "note",
        key,
        tone: "info",
        text: "已创建 Pull Request",
        url: String(d.url),
      });
    }
  }
  return items;
}

const toolLabel: Record<string, string> = {
  read: "读取",
  search_code: "检索",
  list_files: "列出文件",
  git_diff: "查看改动",
  run_tests: "运行测试",
  write: "写入",
  edit: "修改",
  bash: "运行命令",
};
const targetOf = (call: Call) =>
  String(call.args.path ?? call.args.query ?? call.args.command ?? "");

function blockSummary(calls: Call[]) {
  const simulated = calls.some((c) => (c.result as { simulated?: boolean } | undefined)?.simulated);
  const count = (...names: string[]) =>
    calls.filter((c) => names.includes(c.tool)).length;
  const edited = new Set(
    calls
      .filter((c) => c.tool === "write" || c.tool === "edit")
      .map((c) => String(c.args.path)),
  );
  const parts = [
    count("read") && `读取了 ${count("read")} 个文件`,
    count("search_code", "list_files") &&
      `检索了 ${count("search_code", "list_files")} 次`,
    count("bash", "run_tests") &&
      `${simulated ? "预览了" : "运行了"} ${count("bash", "run_tests")} 条命令`,
    edited.size && `${simulated ? "虚拟修改了" : "修改了"} ${edited.size} 个文件`,
    count("git_diff") && "查看了改动",
  ].filter(Boolean);
  return parts.join("，") || "调用了工具";
}

function resultText(result: unknown) {
  if (result === undefined) return "";
  if (typeof result === "string") return result;
  const r = result as Record<string, unknown>;
  if (r.error) return "错误：" + r.error;
  const output = [r.stdout, r.stderr].filter(Boolean).join("\n");
  const code = r.exit_code === undefined ? "" : `\n[退出码 ${r.exit_code}]`;
  return (output || JSON.stringify(result, null, 2)) + code;
}

function failed(call: Call) {
  const r = call.result as Record<string, unknown> | undefined;
  return !!r && typeof r === "object" && (!!r.error || (r.exit_code ?? 0) !== 0);
}

// Files and line counts of the unified diff, for the "changed" summary.
function changes(diff: string) {
  const files: { name: string; add: number; del: number }[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files.push({ name: line.split(" b/").at(-1) || "", add: 0, del: 0 });
    } else if (files.length) {
      const file = files[files.length - 1];
      if (line.startsWith("+") && !line.startsWith("+++")) file.add++;
      else if (line.startsWith("-") && !line.startsWith("---")) file.del++;
    }
  }
  return files;
}

function Work({ item, live }: { item: Extract<Item, { kind: "work" }>; live: boolean }) {
  const running = live && item.calls.some((c) => !c.done);
  return (
    <details className="chat-work">
      <summary>
        <ChevronRight className="chev" />
        <span>{blockSummary(item.calls)}</span>
        {running && <Loader2 className="spin" />}
      </summary>
      <div className="chat-calls">
        {item.calls.map((call) => (
          <details key={call.id} className="chat-call">
            <summary>
              <b>{toolLabel[call.tool] || call.tool}</b>
              <span className="mono ellipsis">{targetOf(call)}</span>
              {failed(call) && <Badge tone="danger">失败</Badge>}
            </summary>
            <pre className="mono small">
              {resultText(call.result).slice(0, 4000) ||
                (call.done ? "（无输出）" : "执行中…")}
            </pre>
          </details>
        ))}
      </div>
    </details>
  );
}

export default function AgentRun() {
  const s = useStore();
  const demo = !!s.repo?.demo;
  const [params, setParams] = useSearchParams();
  const plans = useResource<Plan[]>("/repos/" + s.repo!.id + "/plans");
  const histories = useResource<Run[]>("/repos/" + s.repo!.id + "/runs", 3000);
  // "new" is an empty conversation; without a choice the latest run is shown.
  const picked = params.get("run");
  const runId =
    picked === "new" ? "" : picked || histories.data?.[0]?.id || "";
  const detail = useResource<Run>(runId ? "/runs/" + runId : null, 3000);
  const run = detail.data;
  const tasks =
    plans.data?.find((p) => p.status === "applied")?.tasks ||
    plans.data?.[0]?.tasks ||
    [];
  const [taskId, setTaskId] = useState(params.get("task") || "");
  const [text, setText] = useState("");
  const guest = !s.session?.user;
  const [config, setConfig] = useState<RunConfig>({
    // Visitors may only run read-only or approval-gated runs; the server
    // enforces the same, so the form must not offer the other presets.
    preset: guest || demo ? "approve" : s.settings?.default_permission || "approve",
    tools: {},
    directory: "",
    // Full permission was already confirmed when it was saved as the default
    // in settings, or when it is picked here (see the dialog below).
    full_confirmed: !guest && !demo && s.settings?.default_permission === "full",
    max_steps: s.settings?.max_steps || 40,
    max_tokens: s.settings?.max_tokens || 200000,
    test_command: "",
  });
  // Config the user has already touched wins over defaults that arrive
  // later (a deep-linked page can mount before /api/settings comes back).
  const touched = useRef(false);
  const markTouched = () => {
    touched.current = true;
  };
  useEffect(() => {
    const settings = s.settings;
    if (touched.current || !settings) return;
    setConfig((config) => ({
      ...config,
      preset: guest || demo ? "approve" : settings.default_permission || "approve",
      full_confirmed: !guest && !demo && settings.default_permission === "full",
      max_steps: settings.max_steps || 40,
      max_tokens: settings.max_tokens || 200000,
    }));
  }, [s.settings, guest, demo]);
  // A task linked from the plan page arrives in the input box.
  useEffect(() => {
    const task = tasks.find((t) => t.id === taskId);
    if (task && !text) setText(task.id + " " + task.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, taskId]);
  const [prConfirm, setPrConfirm] = useState(false);
  const [askFull, setAskFull] = useState(false);
  const [view, setView] = useState<AgentView | null>(null);
  const reloadRef = useRef(detail);
  reloadRef.current = detail;
  const live = isActive(run?.status);
  useEffect(() => {
    // A finished run has nothing more to stream until a follow-up restarts it.
    if (!runId || (reloadRef.current.data && !live)) return;
    let source: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    // Every event makes the run data stale, but bursts of events only need
    // one reload; the done event always applies at once.
    const scheduleReload = (immediate = false) => {
      if (pending) {
        if (immediate) {
          clearTimeout(pending);
          pending = undefined;
        } else return;
      }
      pending = setTimeout(
        () => {
          pending = undefined;
          reloadRef.current.reload();
        },
        immediate ? 0 : 300,
      );
    };
    const open = () => {
      source = new EventSource("/api/runs/" + runId + "/events");
      source.onmessage = () => scheduleReload();
      source.addEventListener("done", () => {
        scheduleReload(true);
        source?.close();
      });
      source.onerror = () => {
        // A dropped connection (restart, sleep) is recoverable: only leaving
        // the page ends the stream. The retry backs off to 15 seconds.
        source?.close();
        const delay = Math.min(1000 * 2 ** attempt++, 15000);
        reconnect = setTimeout(open, delay);
      };
    };
    let attempt = 0;
    open();
    return () => {
      source?.close();
      if (reconnect) clearTimeout(reconnect);
      if (pending) clearTimeout(pending);
    };
  }, [runId, live]);
  const active = live;
  const decisions = new Set(
    run?.events
      ?.filter((e) => e.kind === "approval_decision")
      .map((e) => String(e.data.approval_id)),
  );
  const pending =
    run?.events?.filter(
      (e) =>
        e.kind === "approval_requested" &&
        !decisions.has(String(e.data.approval_id)),
    ) || [];
  const items = conversation(run?.events || []);
  const files = run && !active ? changes(run.diff || "") : [];

  // Follow the newest message unless the reader has scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [run?.events?.length, pending.length, run?.status, runId]);
  useEffect(() => {
    stick.current = true;
  }, [runId]);

  function toolPermission(name: string) {
    return (
      config.tools[name] ||
      (toolNames.indexOf(name) < 4
        ? "allow"
        : config.preset === "readonly"
          ? "deny"
          : config.preset === "approve"
            ? "ask"
            : "allow")
    );
  }
  // A finished run in this repository's worktree can take another message.
  const continuing =
    !!run &&
    !!runId &&
    !run.pr_url &&
    ["completed", "needs_review", "accepted", "stopped", "failed"].includes(
      run.status,
    ) &&
    !!run.path;
  async function send() {
    if (!continuing) return start();
    const result = await s.perform("run", () =>
      api<Run>("/runs/" + runId + "/messages", { text: text.trim() }),
    );
    if (result) {
      setText("");
      stick.current = true;
      histories.reload();
      detail.reload();
    }
  }
  async function start() {
    const task = tasks.find((t) => t.id === taskId) || {
      id: "manual",
      title: text.trim(),
      why: "用户指定任务",
      src: "人工输入",
      dep: "—",
      h: 1,
      who: "agent",
      priority: 1,
    };
    const result = await s.perform("run", () =>
      api<Run>("/repos/" + s.repo!.id + "/runs", { task, config }),
    );
    if (result) {
      setText("");
      setTaskId("");
      stick.current = true;
      setParams({ run: result.id });
      histories.reload();
      detail.reload();
    }
  }
  async function approve(id: string, decision: string) {
    await s.perform("approval", async () => {
      await api("/runs/" + runId + "/approvals/" + id, { decision });
      detail.reload();
    });
  }
  async function review(decision: "accept" | "reject") {
    const result = await s.perform("review-run", () =>
      api<Run>("/runs/" + runId + "/review", { decision }),
    );
    if (result) {
      detail.reload();
      histories.reload();
      s.notify(decision === "accept" ? "已通过审核" : "已驳回该运行");
    }
  }
  async function createPR() {
    const result = await s.perform("pr", () =>
      api<{ url: string; simulated?: boolean; message?: string }>("/runs/" + runId + "/pr", {}),
    );
    if (result) {
      setPrConfirm(false);
      detail.reload();
      s.notify(result.simulated ? result.message! : "PR 已创建：" + result.url);
    }
  }
  const customTools = Object.keys(config.tools).length;
  const canSend =
    !active &&
    !!text.trim() &&
    !(!continuing && config.preset === "full" && !config.full_confirmed);
  const canOpenPR =
    !!run &&
    !run.pr_url &&
    ["completed", "accepted"].includes(run.status) &&
    !!run.diff &&
    (demo || !!s.session?.user) &&
    s.repo?.source === "github";

  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title={demo ? "Agent 模拟" : "Agent 运行"}
        description={
          demo
            ? "示例仓库只读；文件改动、测试、命令和 PR 均为模拟，源码不会改变。"
            : run && runId
            ? run.id + " · " + (statusText[run.status] || run.status)
            : "选择规划里的任务，或直接描述要完成的修复。"
        }
      >
      </PageHeader>
      <div className="page-body">
        {detail.error && <Notice error>{detail.error}</Notice>}
        {run?.error && <Notice error>{run.error}</Notice>}
        <section className="card flex chat-layout fill-row">
          <aside className="chat-list" aria-label="对话列表">
            <Button
              variant="outline"
              size="sm"
              disabled={!runId && !text && !taskId}
              onClick={() => {
                stick.current = true;
                setParams({ run: "new" });
              }}
            >
              <Plus />
              新对话
            </Button>
            <div className="chat-list-items">
              {histories.data?.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={"chat-list-item" + (r.id === runId ? " active" : "")}
                  onClick={() => {
                    stick.current = true;
                    setParams({ run: r.id });
                  }}
                >
                  <span className="clamp-2">{r.task.title}</span>
                  <span className="muted small">
                    {dateText(r.created)} · {statusText[r.status] || r.status}
                  </span>
                </button>
              ))}
              {!histories.data?.length && (
                <p className="muted small">还没有对话</p>
              )}
            </div>
          </aside>
          <div className="chat">
          <div
            className="chat-scroll"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {run && runId ? (
              <div className="chat-thread">
                <div className="chat-row user">
                  <div className="chat-bubble">
                    {run.task.id !== "manual" && (
                      <span className="chat-task-id mono">{run.task.id}</span>
                    )}
                    {run.task.title}
                  </div>
                </div>
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
                  ) : item.kind === "work" ? (
                    <div className="chat-row agent" key={item.key}>
                      <span className="chat-avatar" />
                      <Work item={item} live={!!active} />
                    </div>
                  ) : (
                    <div className="chat-row agent" key={item.key}>
                      <span className="chat-avatar" />
                      <div className={"chat-note " + item.tone}>
                        {item.text}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} />
                            查看
                          </a>
                        )}
                      </div>
                    </div>
                  ),
                )}
                {active &&
                  pending.map((e) => (
                    <div className="chat-row agent" key={e.id}>
                      <span className="chat-avatar" />
                      <div className="approval compact">
                        <div className="approval-head">
                          <Hand />
                          <strong>需要批准：{String(e.data.tool)}</strong>
                        </div>
                        <span className="mono small ellipsis">
                          {JSON.stringify(e.data.arguments)}
                        </span>
                        <div className="actions wrap">
                          <BusyButton
                            label="approval"
                            variant="default"
                            size="sm"
                            onClick={() =>
                              void approve(String(e.data.approval_id), "approve")
                            }
                          >
                            批准
                          </BusyButton>
                          <BusyButton
                            label="approval"
                            size="sm"
                            onClick={() =>
                              void approve(String(e.data.approval_id), "reject")
                            }
                          >
                            拒绝
                          </BusyButton>
                          <BusyButton
                            label="approval"
                            size="sm"
                            onClick={() =>
                              void approve(String(e.data.approval_id), "always")
                            }
                          >
                            本次运行始终允许
                          </BusyButton>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setView({
                                kind: "args",
                                tool: String(e.data.tool),
                                data: e.data.arguments,
                              })
                            }
                          >
                            查看参数
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                {active && !pending.length && (
                  <div className="chat-row agent">
                    <span className="chat-avatar" />
                    <div className="chat-thinking">
                      <Loader2 className="spin" />
                      Agent 正在工作…
                    </div>
                  </div>
                )}
                {run && !active && (
                  <div className="chat-row agent">
                    <span className="chat-avatar" />
                    <div className="chat-result">
                      <div className="chat-result-head">
                        <Badge tone={statusTone(run.status)} dot>
                          {statusText[run.status] || run.status}
                        </Badge>
                        {files.length > 0 ? (
                          <span className="small">
                            {demo ? "虚拟修改了" : "修改了"} {files.length} 个文件{" "}
                            <span className="add">
                              +{files.reduce((n, f) => n + f.add, 0)}
                            </span>{" "}
                            <span className="del">
                              −{files.reduce((n, f) => n + f.del, 0)}
                            </span>
                          </span>
                        ) : (
                          <span className="muted small">没有代码改动</span>
                        )}
                      </div>
                      {files.map((f) => (
                        <div className="chat-file" key={f.name}>
                          <span className="mono ellipsis">{f.name}</span>
                          <span className="add mono small">+{f.add}</span>
                          <span className="del mono small">−{f.del}</span>
                        </div>
                      ))}
                      {run.status === "needs_review" && (
                        <Alert tone="warning" title="需要人工审核">
                          <p className="small">
                            运行触及了步数或 Token 上限，改动可能不完整。通过后可以创建
                            PR，驳回则放弃这次改动。
                          </p>
                          <div className="actions">
                            <BusyButton
                              label="review-run"
                              variant="default"
                              disabled={!s.session?.user || !run.diff}
                              onClick={() => void review("accept")}
                            >
                              通过审核
                            </BusyButton>
                            <BusyButton
                              label="review-run"
                              variant="danger"
                              disabled={!s.session?.user}
                              onClick={() => void review("reject")}
                            >
                              驳回
                            </BusyButton>
                          </div>
                        </Alert>
                      )}
                      {run.pr_url ? (
                        <a
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          href={run.pr_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink />
                          查看 PR
                        </a>
                      ) : (
                        run.diff && (
                          <div className="actions wrap">
                            <Button
                              size="sm"
                              disabled={!canOpenPR}
                              onClick={() => setPrConfirm(true)}
                            >
                              <GitPullRequest />
                              {demo ? "预览 PR（模拟）" : "由我确认并创建 PR"}
                            </Button>
                            {!canOpenPR && (
                              <span className="muted small">
                                {!s.session?.user
                                  ? "创建 PR 需要 GitHub 登录"
                                  : s.repo?.source !== "github"
                                    ? "本地仓库不能创建 PR"
                                    : run.status === "needs_review"
                                      ? "审核通过后可创建"
                                      : "运行完成后可创建"}
                              </span>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="chat-empty">
                <Bot />
                <h3>让 Agent 修复一个问题</h3>
                <p className="muted">
                  {demo
                    ? "描述任务或选择规划里的任务，查看虚拟文件变更。测试和命令仅预览，不会真实执行。"
                    : "在下方描述任务，或选择规划里的任务。Agent 会在独立的 Git worktree 里修改代码并运行测试。"}
                </p>
              </div>
            )}
          </div>

          <div className="chat-composer">
            <div className="chat-input">
              <textarea
                className="textarea"
                aria-label="任务描述"
                rows={2}
                value={text}
                placeholder={
                  continuing
                    ? "继续追问或提出修改，Enter 发送，Shift+Enter 换行"
                    : "描述要完成的代码修复，Enter 发送，Shift+Enter 换行"
                }
                onChange={(e) => {
                  setText(e.target.value);
                  // Editing the text makes it a custom task.
                  setTaskId("");
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (canSend && !s.busy) void send();
                  }
                }}
              />
              <div className="chat-tools">
                {continuing ? (
                  <span className="muted small">
                    {demo ? "继续在同一份虚拟文件中对话" : "继续在同一个 worktree 里对话"}；要换任务请点左侧“新对话”。
                  </span>
                ) : (
                  <>
                    <Select
                      aria-label="选择任务"
                      value={taskId}
                      onChange={(e) => {
                        const task = tasks.find((t) => t.id === e.target.value);
                        setTaskId(e.target.value);
                        if (task) setText(task.id + " " + task.title);
                      }}
                    >
                      <option value="">
                        {tasks.length ? "从规划选择任务…" : "规划里暂无任务"}
                      </option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id} {t.title}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label="权限预设"
                      value={config.preset}
                      onChange={(e) => {
                        // Full permission is confirmed once, when it is picked.
                        if (e.target.value === "full") return setAskFull(true);
                        markTouched();
                        setConfig({
                          ...config,
                          preset: e.target.value,
                          tools: {},
                          full_confirmed: false,
                        });
                      }}
                    >
                      {presets.map(([value, title]) => {
                        const locked = (guest || demo) && (value === "auto" || value === "full");
                        return (
                          <option key={value} value={value} disabled={locked}>
                            {demo && value === "approve" ? "模拟操作" : title}
                            {locked ? (demo ? "（示例禁用）" : "（需登录）") : ""}
                          </option>
                        );
                      })}
                    </Select>
                    {!demo && config.preset !== "full" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setView({ kind: "tools" })}
                      >
                        工具权限{customTools ? "（" + customTools + "）" : ""}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setView({ kind: "advanced" })}
                    >
                      高级
                    </Button>
                  </>
                )}
                <span className="spacer" />
                {active ? (
                  <BusyButton
                    label="stop"
                    variant="danger"
                    onClick={() =>
                      void s.perform("stop", async () => {
                        await api("/runs/" + runId + "/stop", {});
                        detail.reload();
                      })
                    }
                  >
                    <Square />
                    停止
                  </BusyButton>
                ) : (
                  <BusyButton
                    label="run"
                    variant="brand"
                    disabled={!canSend}
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

      {view?.kind === "tools" && (
        <Dialog
          title="工具权限"
          description="显示当前预设下各工具的权限，可单独覆盖；切换权限预设会清除覆盖。"
          onClose={() => setView(null)}
        >
          {toolNames.map((name) => (
            <label className="tool-row" key={name}>
              <span className="mono">{name}</span>
              <Select
                aria-label={name + "权限"}
                value={toolPermission(name)}
                onChange={(e) => {
                  markTouched();
                  setConfig({
                    ...config,
                    tools: { ...config.tools, [name]: e.target.value },
                  });
                }}
              >
                <option value="allow">允许</option>
                <option value="ask">询问</option>
                <option value="deny">禁止</option>
              </Select>
            </label>
          ))}
        </Dialog>
      )}
      {view?.kind === "advanced" && (
        <Dialog title="高级设置" onClose={() => setView(null)}>
          <div className="stack" style={{ gap: 14, paddingTop: 8 }}>
            <Field label="工作目录">
              <Input
                mono
                aria-label="工作目录"
                value={config.directory}
                disabled={demo}
                onChange={(e) => {
                  markTouched();
                  setConfig({ ...config, directory: e.target.value });
                }}
                placeholder="自动创建独立 worktree"
              />
            </Field>
            <Field label="自定义测试命令">
              <Input
                mono
                aria-label="测试命令"
                value={config.test_command}
                disabled={demo}
                onChange={(e) => {
                  markTouched();
                  setConfig({ ...config, test_command: e.target.value });
                }}
                placeholder="自动识别 pytest / npm test / go test"
              />
            </Field>
            <div className="form-grid">
              <Field label="最大步数">
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={config.max_steps}
                  onChange={(e) => {
                    markTouched();
                    setConfig({ ...config, max_steps: Number(e.target.value) });
                  }}
                />
              </Field>
              <Field label="Token 预算">
                <Input
                  type="number"
                  min="1000"
                  value={config.max_tokens}
                  onChange={(e) => {
                    markTouched();
                    setConfig({ ...config, max_tokens: Number(e.target.value) });
                  }}
                />
              </Field>
            </div>
          </div>
        </Dialog>
      )}
      {view?.kind === "args" && (
        <Dialog size="wide" title={"待批准：" + view.tool} onClose={() => setView(null)}>
          <Code text={JSON.stringify(view.data, null, 2)} />
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
                  markTouched();
                  setConfig({
                    ...config,
                    preset: "full",
                    tools: {},
                    full_confirmed: true,
                  });
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
            Agent 可以不限路径地读写文件、运行命令，无需逐条审批；删除、推送、提交等高风险命令仍会询问。
          </p>
        </Dialog>
      )}
      {prConfirm && run && (
        <Dialog
          size="wide"
          title={demo ? "PR 模拟预览" : "确认创建 PR"}
          description={
            demo ? "仅展示虚拟 diff，不提交、不推送、不创建真实 PR。" : <>
              将 <span className="mono">{run.branch}</span> 推送到{" "}
              {s.repo?.name} 并创建 Pull Request。
            </>
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setPrConfirm(false)}>
                取消
              </Button>
              <BusyButton label="pr" variant="default" onClick={() => void createPR()}>
                {demo ? "查看模拟结果" : "确认推送并创建 PR"}
              </BusyButton>
            </>
          }
          onClose={() => setPrConfirm(false)}
        >
          <DiffView text={run.diff} />
        </Dialog>
      )}
    </Page>
  );
}
