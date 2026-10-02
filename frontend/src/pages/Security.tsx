import {
  CalendarCheck,
  Check,
  ExternalLink,
  Loader2,
  Pause,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Finding, type Plan, type Scan } from "../api";
import { useFitPage } from "../lib/fit";
import { useWorkflow, WorkflowSteps } from "./workflow";
import { findingPlanLinks, type PlanLink } from "../lib/finding-plan";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { dateText, severityTone, statusText, type Tone } from "../lib/utils";
import {
  Alert,
  Badge,
  Button,
  BusyButton,
  buttonVariants,
  Card,
  Code,
  Dialog,
  Empty,
  Markdown,
  Notice,
  Page,
  PageHeader,
  Pager,
  Select,
} from "../components";

const sourceText: Record<string, string> = {
  running: "进行中",
  pausing: "暂停中",
  paused: "已暂停",
  complete: "已完成",
  partial: "部分完成",
  skipped: "已跳过",
  error: "失败",
};
// A finding is 待处理 until something decides it. 已忽略: marked as a false
// positive, by the AI when it had a stated fact or by a person. 等待人工: the AI
// could not settle whether it is real. 已规划: a plan references it.
type FindingState = "open" | "human" | "planned" | "ignored";
type StateFilter = "active" | FindingState | "all";
const stateLabel: Record<FindingState, string> = {
  open: "待处理",
  human: "等待人工",
  planned: "已规划",
  ignored: "已忽略",
};
const stateFilters: [StateFilter, string][] = [
  ["active", "未忽略"],
  ["open", "待处理"],
  ["human", "等待人工"],
  ["planned", "已规划"],
  ["ignored", "已忽略"],
  ["all", "全部"],
];
// "疑似误报" is what older reviews called an undecided finding.
const undecided = (f: Finding) =>
  f.review === "需人工" || f.review === "疑似误报";

function planText(links: PlanLink[]) {
  return links
    .map(
      (l) =>
        l.task + (l.scheduled ? "，排在 " + l.date : "，尚未排期") + "：" + l.title,
    )
    .join("\n");
}

const sourceTone = (status: string): Tone =>
  status === "complete" ? "success" : status === "error" ? "danger" : "warning";

// Scan stages in the order the backend runs them; the AI review follows the scan.
const stages = ["内置规则", "OSV.dev", "bandit", "semgrep"];

function ScanProgress({
  scan,
  withReview,
}: {
  scan: Scan;
  withReview: boolean;
}) {
  const scanning = scan.status === "running";
  const named = (name: string) => scan.sources.find((x) => x.name === name);
  const list = withReview ? [...stages, "AI 复核"] : stages;
  // The first stage with no report yet is the one running now.
  const current = scanning ? stages.find((n) => !named(n)) : undefined;
  return (
    <div className="scan-progress" role="status">
      <div className="head">
        <Loader2 className="spin" />
        <strong>{scanning ? "正在扫描" : "AI 正在复核发现"}</strong>
        <span className="muted small">
          已发现 {scan.findings.length} 条
          {scanning ? "，数量还会增加" : ""}
        </span>
      </div>
      <ol className="stages">
        {list.map((name) => {
          const item = named(name);
          const state = item
            ? item.status === "running" || item.status === "pausing"
              ? "run"
              : item.status === "error"
                ? "fail"
                : "done"
            : name === current
              ? "run"
              : "wait";
          return (
            <li key={name} className={state}>
              <span className="mark">
                {state === "done" ? (
                  <Check />
                ) : state === "fail" ? (
                  <X />
                ) : state === "run" ? (
                  <Loader2 className="spin" />
                ) : null}
              </span>
              {name}
              <span className="muted">
                {state === "run"
                  ? item?.status === "pausing"
                    ? "暂停中"
                    : "进行中"
                  : state === "wait"
                    ? "等待"
                    : item
                      ? sourceText[item.status] || item.status
                      : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Security() {
  const s = useStore();
  // Poll faster while a scan or its AI review is in progress.
  const [fast, setFast] = useState(false);
  const scans = useResource<Scan[]>(
    "/repos/" + s.repo!.id + "/scans",
    fast ? 1200 : 3000,
  );
  const [selected, setSelected] = useState("");
  // The scan just started, until the polled list contains it, so the page
  // switches to "scanning" at once instead of showing the previous scan.
  const [started, setStarted] = useState<Scan | null>(null);
  const [severity, setSeverity] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState<StateFilter>("active");
  const [bulkOpen, setBulkOpen] = useState(false);
  const plans = useResource<Plan[]>("/repos/" + s.repo!.id + "/plans");
  const flow = useWorkflow();
  const links = findingPlanLinks(plans.data || []);
  const stateOf = (f: Finding): FindingState =>
    f.status === "ignored"
      ? "ignored"
      : links.has(f.id)
        ? "planned"
        : undecided(f)
          ? "human"
          : "open";
  const [finding, setFinding] = useState<Finding | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const scan =
    scans.data?.find((x) => x.id === selected) ||
    (started && started.id === selected ? started : undefined) ||
    scans.data?.[0];
  const scanning = scan?.status === "running";
  const review = scan?.sources.find(
    (x) =>
      x.name === "AI 复核" && (x.status === "running" || x.status === "pausing"),
  );
  const reviewing = !!review;
  const paused = scan?.sources.some(
    (x) => x.name === "AI 复核" && x.status === "paused",
  );
  useEffect(() => setFast(scanning || reviewing), [scanning, reviewing]);
  const rows =
    scan?.findings.filter(
      (f) =>
        (severity === "all" || f.severity === severity) &&
        (source === "all" || f.source === source) &&
        (status === "all" ||
          (status === "active" ? stateOf(f) !== "ignored" : stateOf(f) === status)),
    ) || [];
  const table = useFitPage(rows, 46, 36);
  const waiting = scan?.findings.filter((f) => stateOf(f) === "human") || [];
  async function setFindings(ids: string[], next: "open" | "ignored") {
    const data = await s.perform("bulk", () =>
      api<Scan>("/scans/" + scan!.id + "/findings/status", {
        ids,
        status: next,
      }),
    );
    if (data) {
      scans.reload();
      s.notify(
        next === "ignored"
          ? "已将 " + ids.length + " 项标记为误报，它们不会再进入规划"
          : "已恢复 " + ids.length + " 项为待处理",
      );
    }
    return !!data;
  }
  useEffect(
    () => table.setPage(0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [severity, source, status, scan?.id],
  );
  async function start() {
    const data = await s.perform("scan", () =>
      api<Scan>("/repos/" + s.repo!.id + "/scans", {}),
    );
    if (data) {
      setStarted(data);
      setSelected(data.id);
      scans.reload();
    }
  }
  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title="漏洞分析"
        description={
          scan
            ? dateText(scan.created) +
              " · " +
              (statusText[scan.status] || scan.status) +
              " · " +
              scan.sha.slice(0, 10)
            : "扫描依赖漏洞与静态风险，支持 AI 复核。"
        }
      >
        <WorkflowSteps steps={flow.steps} />
        {reviewing ? (
          // Not a BusyButton: a review started from the button holds `busy`
          // until it returns, and pausing is exactly what ends that wait.
          <Button
            variant="outline"
            disabled={review?.status === "pausing"}
            onClick={() =>
              void api("/scans/" + scan!.id + "/review/pause", {})
                .then(() => scans.reload())
                .catch((e: Error) => s.notify(e.message, true))
            }
          >
            <Pause />
            {review?.status === "pausing" ? "暂停中…" : "暂停复核"}
          </Button>
        ) : (
          <BusyButton
            label="review"
            disabled={!scan || scan.status !== "complete"}
            onClick={() =>
              void s.perform("review", async () => {
                await api("/scans/" + scan!.id + "/review", {});
                scans.reload();
              })
            }
          >
            <Sparkles />
            {paused ? "继续复核" : "LLM 复核"}
          </BusyButton>
        )}
        <Button
          variant="default"
          disabled={scanning || reviewing || !!s.busy}
          onClick={() => void start()}
        >
          {scanning || s.busy === "scan" ? (
            <>
              <Loader2 className="spin" />
              扫描中…
            </>
          ) : reviewing ? (
            <>
              <Loader2 className="spin" />
              AI 复核中 {review?.done ?? 0}/{review?.total ?? 0}
            </>
          ) : (
            <>
              <ScanLine />
              开始扫描
            </>
          )}
        </Button>
      </PageHeader>
      <div className="page-body">
        {scans.error && <Notice error>{scans.error}</Notice>}
        {scan?.error && <Notice error>{scan.error}</Notice>}
        {scan && (scanning || reviewing) && (
          <ScanProgress scan={scan} withReview={!!s.settings?.llm_configured} />
        )}
        <Card flex className="fill-row">
          <div className="toolbar">
            <Select
              aria-label="扫描历史"
              value={scan?.id || ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {scans.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {dateText(x.created)} · {statusText[x.status]}
                </option>
              ))}
              {!scans.data?.length && <option value="">暂无扫描</option>}
            </Select>
            <Select
              aria-label="严重度"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              {[
                "all",
                "critical",
                "high",
                "medium",
                "moderate",
                "low",
                "unknown",
              ].map((v) => (
                <option key={v} value={v}>
                  {v === "all" ? "全部严重度" : v}
                </option>
              ))}
            </Select>
            <Select
              aria-label="来源"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">全部来源</option>
              {[...new Set(scan?.findings.map((f) => f.source))].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
            <Select
              aria-label="发现状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as StateFilter)}
            >
              {stateFilters.map(([v, t]) => (
                <option key={v} value={v}>
                  {v === "all" ? "全部状态" : t}
                </option>
              ))}
            </Select>
            <div className="spacer" />
            {waiting.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkOpen(true)}
              >
                等待人工 · {waiting.length}
              </Button>
            )}
            {scan && scan.sources.length > 0 && (
              <button
                type="button"
                className="chip-button"
                onClick={() => setSourcesOpen(true)}
              >
                <Badge
                  tone={
                    scan.sources.some((x) => x.status === "error")
                      ? "danger"
                      : scan.sources.every((x) => x.status === "complete")
                        ? "success"
                        : "warning"
                  }
                  dot
                >
                  扫描来源 · {scan.sources.filter((x) => x.status === "complete").length}/
                  {scan.sources.length}
                </Badge>
              </button>
            )}
          </div>
          <div className="fit-area" ref={table.ref}>
            {rows.length > 0 && (
              <table className="data-table live-table">
                <colgroup>
                  <col style={{ width: 96 }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: "30%" }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 112 }} />
                </colgroup>
                <thead>
                  <tr>
                    {["严重度", "问题", "来源", "位置", "LLM 复核", "状态"].map(
                      (t) => (
                        <th key={t}>{t}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {table.visible.map((f, i) => (
                    <tr
                      key={f.id}
                      className="click"
                      style={{ animationDelay: i * 18 + "ms" }}
                      onClick={() => setFinding(f)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setFinding(f);
                      }}
                    >
                      <td>
                        <Badge tone={severityTone(f.severity)}>
                          {f.severity}
                        </Badge>
                      </td>
                      <td title={f.title}>
                        <span className="row-title">
                          {f.id} · {f.title}
                        </span>
                      </td>
                      <td>{f.source}</td>
                      <td className="mono small" title={f.file + ":" + f.line}>
                        {f.file}:{f.line}
                      </td>
                      <td>{f.review}</td>
                      <td>
                        {(() => {
                          const state = stateOf(f);
                          const link = links.get(f.id);
                          return state === "planned" && link ? (
                            <Badge
                              tone={link[0].scheduled ? "brand" : "info"}
                              title={planText(link)}
                            >
                              {link[0].scheduled ? "已规划" : "待排期"} · {link[0].task}
                              {link.length > 1 && " +" + (link.length - 1)}
                            </Badge>
                          ) : (
                            <Badge
                              tone={
                                state === "ignored"
                                  ? "muted"
                                  : state === "human"
                                    ? "warning"
                                    : "default"
                              }
                              title={f.evidence || undefined}
                            >
                              {stateLabel[state]}
                              {state === "ignored" && f.handled_by === "ai" && " · AI"}
                            </Badge>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!rows.length && (
              <Empty
                icon={scanning ? <Loader2 className="spin" /> : <ShieldCheck />}
                title={
                  scanning
                    ? "扫描进行中"
                    : scan
                      ? "没有匹配的发现"
                      : "尚未扫描"
                }
              >
                {scanning
                  ? "发现会随扫描进度陆续出现在这里。"
                  : scan
                    ? "调整上方的筛选条件试试。"
                    : "开始扫描依赖漏洞与静态风险。"}
              </Empty>
            )}
          </div>
          <div className="card-foot">
            <span>
              {scan
                ? "共 " +
                  scan.findings.length +
                  " 条发现，已筛选 " +
                  rows.length +
                  " 条" +
                  (scanning ? "（扫描中，数量还会增加）" : "")
                : "—"}
            </span>
            <Pager
              page={table.page}
              size={table.size}
              total={rows.length}
              onChange={table.setPage}
            />
          </div>
        </Card>
      </div>
      {sourcesOpen && scan && (
        <Dialog title="扫描来源" onClose={() => setSourcesOpen(false)}>
          {scan.sources.map((x) => (
            <div className="step-row source-row" key={x.name}>
              <Badge tone={sourceTone(x.status)} dot>
                {x.name} · {sourceText[x.status] || x.status}
              </Badge>
              <span className="muted small">
                {x.reason ||
                  x.error ||
                  (x.packages ? "已查询 " + x.packages + " 个依赖" : "")}
              </span>
            </div>
          ))}
        </Dialog>
      )}
      {bulkOpen && scan && (
        <Dialog
          title={"处理 " + waiting.length + " 项等待人工的发现"}
          description="AI 复核后无法确定它们是真实风险还是误报，需要你来判断。"
          footer={
            <>
              <Button variant="outline" onClick={() => setBulkOpen(false)}>
                取消
              </Button>
              <BusyButton
                label="bulk"
                variant="default"
                onClick={() =>
                  void setFindings(
                    waiting.map((f) => f.id),
                    "ignored",
                  ).then((ok) => ok && setBulkOpen(false))
                }
              >
                我确认都是误报，全部忽略
              </BusyButton>
            </>
          }
          onClose={() => setBulkOpen(false)}
        >
          <Alert tone="info">
            只在你确认它们都不是风险时使用。忽略后不再计入概览，也不会进入任务规划，可以随时在“已忽略”里逐项恢复。不确定的请逐项点开查看。
          </Alert>
          <div style={{ marginTop: 12 }}>
            {waiting.slice(0, 8).map((f) => (
              <div className="step-row" key={f.id}>
                <span className="ellipsis small">
                  {f.id} · {f.title}
                </span>
                <span className="mono small muted ellipsis">
                  {f.file}:{f.line}
                </span>
              </div>
            ))}
            {waiting.length > 8 && (
              <p className="muted small" style={{ marginTop: 8 }}>
                另有 {waiting.length - 8} 项。
              </p>
            )}
          </div>
        </Dialog>
      )}
      {finding && scan && (
        <Dialog
          size="wide"
          title={finding.id + " · " + finding.title}
          description={
            <>
              <Badge tone={severityTone(finding.severity)}>
                {finding.severity}
              </Badge>{" "}
              <span className="mono">
                {finding.file}:{finding.line} · {finding.rule}
              </span>
            </>
          }
          footer={
            <>
              {finding.status === "ignored" ? (
                <BusyButton
                  label="bulk"
                  onClick={() =>
                    void setFindings([finding.id], "open").then(
                      (ok) => ok && setFinding(null),
                    )
                  }
                >
                  <Undo2 />
                  恢复为待处理
                </BusyButton>
              ) : (
                <BusyButton
                  label="bulk"
                  onClick={() =>
                    void setFindings([finding.id], "ignored").then(
                      (ok) => ok && setFinding(null),
                    )
                  }
                >
                  标记误报
                </BusyButton>
              )}
              {links.get(finding.id) ? (
                <Link
                  className={buttonVariants({ variant: "default" })}
                  to={links.get(finding.id)![0].scheduled ? "/calendar" : "/planning"}
                  onClick={() => setFinding(null)}
                >
                  <CalendarCheck />
                  {links.get(finding.id)![0].scheduled ? "查看排期" : "去排期"}
                </Link>
              ) : (
                finding.status !== "ignored" && (
                  <Link
                    className={buttonVariants({ variant: "default" })}
                    to="/planning"
                    onClick={() => setFinding(null)}
                  >
                    纳入规划
                  </Link>
                )
              )}
            </>
          }
          onClose={() => setFinding(null)}
        >
          {finding.status === "ignored" && finding.handled_by !== "ai" && (
            <Alert tone="default" title="已标记为误报">
              这一项已忽略，不会进入任务规划，也不计入概览。
            </Alert>
          )}
          {finding.status === "ignored" && finding.handled_by === "ai" && (
            <Alert tone="info" title="AI 已判定为误报并忽略">
              {finding.evidence || "AI 没有记录依据"}
              。如果你不同意，点“恢复为待处理”。
            </Alert>
          )}
          {stateOf(finding) === "human" && (
            <Alert tone="warning" title="等待人工判断">
              AI 无法确定这是否是真实风险
              {finding.evidence ? "（" + finding.evidence + "）" : ""}
              。确认是误报请点“标记误报”，它将不再进入规划；否则它会像其他发现一样被排进任务。
            </Alert>
          )}
          {links.get(finding.id) && (
            <Alert
              tone="success"
              title={
                links.get(finding.id)![0].scheduled
                  ? "已纳入规划并排期"
                  : "已纳入规划，尚未排期"
              }
            >
              {links
                .get(finding.id)!
                .map(
                  (l) =>
                    l.task +
                    " " +
                    l.title +
                    (l.scheduled ? "（" + l.date + " 起）" : ""),
                )
                .join("；")}
            </Alert>
          )}
          <h3>代码</h3>
          <Code text={finding.code} />
          <h3>LLM 复核 · {finding.review}</h3>
          {finding.explanation ? (
            <Markdown text={finding.explanation} />
          ) : (
            <p className="muted">尚未执行 LLM 复核</p>
          )}
          <h3>修复建议</h3>
          <Markdown text={finding.suggestion} />
          {finding.url && (
            <p>
              <a href={finding.url} target="_blank" rel="noreferrer">
                查看漏洞公告 <ExternalLink size={12} style={{ verticalAlign: -1 }} />
              </a>
            </p>
          )}
        </Dialog>
      )}
    </Page>
  );
}
