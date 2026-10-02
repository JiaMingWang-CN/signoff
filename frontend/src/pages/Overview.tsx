import {
  CalendarDays,
  CircleDot,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  api,
  type Issue,
  type Plan,
  type Repo,
  type Run,
  type Scan,
  type Settings as SettingsData,
} from "../api";
import { useFitPage } from "../lib/fit";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import {
  dateText,
  severityTone,
  statusText,
} from "../lib/utils";
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardHeader,
  Dialog,
  Empty,
  Markdown,
  Page,
  PageHeader,
  Pager,
  Segmented,
  StatusDot,
  Tabs,
} from "../components";
import IndexStatistics from "./IndexStatistics";

const syncModeText: Record<string, string> = {
  incremental: "增量",
  full: "全量",
  code: "仅代码",
};
const syncTriggerText: Record<string, string> = { manual: "手动", auto: "自动" };

// What the last sync did, plus whether auto-sync is on.
export function SyncStatus({
  repo,
  settings,
}: {
  repo: Repo;
  settings: SettingsData | null;
}) {
  const last = repo.last_sync || {};
  const mode = syncModeText[settings?.sync_mode || "incremental"];
  const auto =
    repo.source !== "github"
      ? ""
      : "同步方式：" +
        mode +
        " · " +
        (settings?.auto_sync_enabled
          ? "自动同步：每 " + settings.auto_sync_interval + " 分钟"
          : "自动同步：未开启");
  return (
    <div className="sync-status card">
      <span
        className={"pulse " + (last.error ? "bad" : repo.syncing ? "busy" : "")}
      />
      <div className="txt">
        {last.at ? (
          <span>
            上次同步 · {syncModeText[last.mode || "code"]}
            {last.fell_back && "（无基线，已回退为全量）"} ·{" "}
            {syncTriggerText[last.trigger || "manual"]} · {dateText(last.at)}
            {repo.source === "github" &&
              " · 新增 " +
                (last.added ?? 0) +
                " · 更新 " +
                (last.updated ?? 0) +
                " · 删除 " +
                (last.removed ?? 0) +
                " · 共 " +
                (last.total ?? 0) +
                " 个 Issue"}
            {last.truncated && " · 超过 1000 个，仅同步了前 1000 个"}
          </span>
        ) : (
          <span>尚未同步</span>
        )}
        {last.error && (
          <span className="sync-error" role="alert">
            最近一次同步失败：{last.error}
          </span>
        )}
      </div>
      <span className="muted small">{auto}</span>
    </div>
  );
}

type PoolItem =
  | { kind: "finding"; id: string; sort: number; scan: Scan["findings"][number] }
  | { kind: "issue"; id: string; sort: number; issue: Issue };

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  moderate: 2,
  low: 3,
  unknown: 4,
};

function StatCard({
  to,
  icon: Icon,
  label,
  value,
  unit,
  foot,
  progress,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  foot: React.ReactNode;
  progress?: number;
}) {
  return (
    <Link className="card stat" to={to}>
      <div className="label">
        {label}
        <Icon />
      </div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {progress !== undefined && (
        <div className="bar">
          <i style={{ width: progress + "%" }} />
        </div>
      )}
      <div className="foot">{foot}</div>
    </Link>
  );
}

export default function Overview() {
  const s = useStore();
  const navigate = useNavigate();
  const repo = s.repo!;
  const scans = useResource<Scan[]>("/repos/" + repo.id + "/scans", 3000);
  const plans = useResource<Plan[]>("/repos/" + repo.id + "/plans");
  const runs = useResource<Run[]>("/repos/" + repo.id + "/runs", 3000);
  const [filter, setFilter] = useState<"all" | "finding" | "issue">("all");
  const [side, setSide] = useState<"runs" | "plan">("runs");
  const [issue, setIssue] = useState<Issue | null>(null);

  const scan = scans.data?.[0];
  const current = plans.data?.find((p) => p.status === "applied");
  const findings = scan?.findings.filter((f) => f.status !== "ignored") || [];
  const open = repo.issues.filter((i) => i.state === "open");
  const severe = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  const pool: PoolItem[] = [
    ...findings.map(
      (f): PoolItem => ({
        kind: "finding",
        id: f.id,
        sort: severityOrder[f.severity] ?? 4,
        scan: f,
      }),
    ),
    ...open.map(
      (i): PoolItem => ({
        kind: "issue",
        id: "#" + i.number,
        sort: 10 - i.number / 1e6,
        issue: i,
      }),
    ),
  ]
    .filter((p) => filter === "all" || p.kind === filter)
    .sort((a, b) => a.sort - b.sort);
  const table = useFitPage(pool, 46, 36);
  const side_runs = useFitPage(runs.data || [], 56);
  const side_tasks = useFitPage(current?.calendar || [], 56);
  const last =
    current?.calendar
      .map((t) => t.date)
      .sort()
      .at(-1) || "";
  const doneCount = current
    ? current.calendar.filter((t) => t.date <= new Date().toLocaleDateString("en-CA")).length
    : 0;
  const progress = current?.calendar.length
    ? Math.round((doneCount / current.calendar.length) * 100)
    : 0;

  return (
    <Page>
      <PageHeader
        crumb={repo.name.split("/").at(-1)}
        title="概览"
        meta={
          <div className="meta">
            <span>
              <GitBranch />
              <span className="mono">{repo.branch}</span>
            </span>
            <span>
              <GitCommitHorizontal />
              <span className="mono">{repo.sha.slice(0, 10)}</span>
            </span>
            <span className="mono ellipsis" style={{ maxWidth: 420 }} title={repo.path}>
              {repo.path}
            </span>
          </div>
        }
      >
        {repo.source === "github" && (
          <a
            className={buttonVariants({ variant: "outline" })}
            href={"https://github.com/" + repo.name}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink />在 GitHub 打开
          </a>
        )}
        <Button
          disabled={repo.syncing || !!s.busy}
          onClick={() =>
            void s.perform("sync", async () => {
              // The mode (incremental / full) comes from settings.
              const result = await api<Repo>("/repos/" + repo.id + "/sync", {});
              if (result.simulated) s.notify(result.message!);
              s.reload();
            })
          }
        >
          {repo.syncing ? (
            <>
              <Loader2 className="spin" />
              同步中…
            </>
          ) : (
            <>
              <RefreshCw />
              {repo.demo ? "预览同步" : "同步"}
            </>
          )}
        </Button>
      </PageHeader>
      <div className="page-body">
        <SyncStatus repo={repo} settings={s.settings} />
        <div className="stats">
          <StatCard
            to="/search"
            icon={FileCode2}
            label="代码索引"
            value={(repo.stats.fileCount ?? repo.stats.file_count).toLocaleString()}
            unit="文件"
            foot={
              repo.stats.nodeCount
                ? repo.stats.nodeCount.toLocaleString() +
                  " 符号 · " +
                  (repo.stats.edgeCount ?? 0).toLocaleString() +
                  " 条边"
                : "尚未索引符号"
            }
          />
          <StatCard
            to="/search"
            icon={CircleDot}
            label="Open Issue"
            value={String(open.length)}
            foot={"共 " + repo.issues.length + " 个 Issue"}
          />
          <StatCard
            to="/security"
            icon={ShieldAlert}
            label="漏洞发现"
            value={String(findings.length)}
            foot={
              scan ? (
                <>
                  {severe > 0 && (
                    <Badge tone="danger" small>
                      {severe} 高危
                    </Badge>
                  )}
                  {severe > 0 ? "其余 " + (findings.length - severe) : "无高危"}
                </>
              ) : (
                "尚未扫描"
              )
            }
          />
          <StatCard
            to="/calendar"
            icon={CalendarDays}
            label="排期进度"
            value={current ? last || "—" : "尚未生成"}
            progress={current ? progress : undefined}
            foot={
              current
                ? current.calendar.length + " 个排期项 · v" + current.version
                : "确认任务分工后生成"
            }
          />
        </div>
        <div className="cols overview-main fill-row">
          <Card flex>
            <CardHeader
              title={
                <>
                  问题池
                  <Badge tone="muted" small>
                    {open.length + findings.length}
                  </Badge>
                </>
              }
              action={
                <>
                  <Segmented
                    label="问题类型"
                    value={filter}
                    onChange={setFilter}
                    items={[
                      { value: "all", label: "全部" },
                      { value: "finding", label: "漏洞" },
                      { value: "issue", label: "Issue" },
                    ]}
                  />
                  <Link className="link-more" to="/planning">
                    去规划
                  </Link>
                </>
              }
            />
            <div className="fit-area" ref={table.ref}>
              {table.total ? (
                <table className="data-table live-table">
                  <colgroup>
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 96 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>标题</th>
                      <th>来源</th>
                      <th>级别</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.visible.map((p, i) => (
                      <tr
                        key={p.kind + p.id}
                        className="click"
                        style={{ animationDelay: i * 18 + "ms" }}
                        tabIndex={0}
                        onClick={() =>
                          p.kind === "issue"
                            ? setIssue(p.issue)
                            : navigate("/security")
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          if (p.kind === "issue") setIssue(p.issue);
                          else navigate("/security");
                        }}
                      >
                        {p.kind === "issue" ? (
                          <>
                            <td>
                              <span className="row-title">
                                #{p.issue.number} {p.issue.title}
                              </span>
                              <span className="sub">
                                {p.issue.labels.join(" · ") || "无标签"}
                              </span>
                            </td>
                            <td>
                              <span className="kind">
                                <CircleDot />
                                Issue
                              </span>
                            </td>
                            <td>
                              <Badge tone="info">待处理</Badge>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <span className="row-title">{p.scan.title}</span>
                              <span className="sub mono">
                                {p.scan.file}:{p.scan.line}
                              </span>
                            </td>
                            <td>
                              <span className="kind">
                                <ShieldAlert />
                                {p.scan.source}
                              </span>
                            </td>
                            <td>
                              <Badge tone={severityTone(p.scan.severity)}>
                                {p.scan.severity}
                              </Badge>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="暂无问题">先扫描仓库或同步 Issue。</Empty>
              )}
            </div>
            <div className="card-foot">
              <span>
                显示 {table.visible.length} / {table.total} 项
              </span>
              {table.total > 0 && (
                <Pager
                  page={table.page}
                  size={table.size}
                  total={table.total}
                  onChange={table.setPage}
                />
              )}
            </div>
          </Card>
          <div className="stack">
            <Card flex className="grow">
              <div style={{ padding: "0 16px" }}>
                <Tabs
                  value={side}
                  onChange={setSide}
                  label="最近动态"
                  items={[
                    { value: "runs", label: "最近运行" },
                    { value: "plan", label: "最近排期" },
                  ]}
                />
              </div>
              <div
                className="fit-area"
                ref={side === "runs" ? side_runs.ref : side_tasks.ref}
              >
                {side === "runs" ? (
                  side_runs.total ? (
                    side_runs.visible.map((r, i) => (
                      <Link
                        key={r.id}
                        className="row-link"
                        style={{ height: 56, animationDelay: i * 20 + "ms" }}
                        to={"/agent?run=" + r.id}
                      >
                        <StatusDot status={r.status} />
                        <div>
                          <div className="t ellipsis">{r.task.title}</div>
                          <div className="m">
                            <span>{statusText[r.status] || r.status}</span>
                            <span>{dateText(r.created)}</span>
                          </div>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <Empty title="尚无 Agent 运行">
                      在规划页确认任务后，交给 Agent 执行。
                    </Empty>
                  )
                ) : side_tasks.total ? (
                  side_tasks.visible.map((t, i) => (
                    <Link
                      key={t.id + t.date}
                      className="row-link"
                      style={{ height: 56, animationDelay: i * 20 + "ms" }}
                      to="/calendar"
                    >
                      <Badge tone={t.who === "human" ? "brand" : "info"}>
                        {t.id}
                      </Badge>
                      <div>
                        <div className="t ellipsis">{t.title}</div>
                        <div className="m">
                          <span className="mono">{t.date}</span>
                          <span>
                            {t.who === "human" ? "人" : "Agent"} · {t.hours}h
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <Empty title="尚未生成排期">确认任务分工后生成排期。</Empty>
                )}
              </div>
              <div className="card-foot">
                {side === "runs" ? (
                  <>
                    <span>{side_runs.total} 次运行</span>
                    <Link className="link-more" to="/runs">
                      全部记录
                    </Link>
                  </>
                ) : (
                  <>
                    <span>{side_tasks.total} 个排期项</span>
                    <Link className="link-more" to="/calendar">
                      打开日历
                    </Link>
                  </>
                )}
              </div>
            </Card>
            <IndexStatistics stats={repo.stats} />
          </div>
        </div>
      </div>
      {issue && (
        <Dialog
          size="wide"
          title={"#" + issue.number + " " + issue.title}
          header={
            <div className="actions wrap" style={{ marginBottom: 6 }}>
              <Badge tone={issue.state === "open" ? "success" : "muted"}>
                {issue.state}
              </Badge>
              {issue.labels.map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
            </div>
          }
          footer={
            <>
              <a
                className={buttonVariants({ variant: "outline" })}
                href={issue.html_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink />在 GitHub 打开
              </a>
              <Button
                onClick={() => {
                  setIssue(null);
                  navigate("/planning");
                }}
              >
                去规划
              </Button>
            </>
          }
          onClose={() => setIssue(null)}
        >
          <Markdown text={issue.body || "（无正文）"} />
          {issue.comments_text && (
            <>
              <h3>评论</h3>
              <Markdown text={issue.comments_text} />
            </>
          )}
        </Dialog>
      )}
    </Page>
  );
}
