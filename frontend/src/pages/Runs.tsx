import { Bot, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { type Audit, type Run, type RunEvent } from "../api";
import { useFitPage } from "../lib/fit";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import {
  dateText,
  isActive,
  shortSha,
  statusText,
  statusTone,
} from "../lib/utils";
import {
  Badge,
  buttonVariants,
  Button,
  Card,
  Code,
  Dialog,
  DiffView,
  Empty,
  Notice,
  Page,
  PageHeader,
  Pager,
  SearchInput,
  Segmented,
  Tabs,
} from "../components";

type RunFilter = "all" | "active" | "completed" | "other";
const matches = (r: Run, filter: RunFilter) =>
  filter === "all" ||
  (filter === "active" && isActive(r.status)) ||
  (filter === "completed" && ["completed", "complete"].includes(r.status)) ||
  (filter === "other" &&
    !isActive(r.status) &&
    !["completed", "complete"].includes(r.status));

const timeText = (value: string) =>
  value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—";

function eventSummary(event: RunEvent) {
  return event.data.tool
    ? String(event.data.tool)
    : event.data.text
      ? String(event.data.text).replace(/\s+/g, " ")
      : "";
}

// Run details in a side sheet so the list keeps its place.
function RunSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useResource<Run>("/runs/" + id, 3000);
  const run = detail.data;
  const [tab, setTab] = useState<"timeline" | "diff">("timeline");
  return (
    <Dialog
      sheet
      title={run?.task.title || id}
      header={
        <div className="actions" style={{ marginBottom: 6 }}>
          <span className="mono muted">{id}</span>
          {run && (
            <Badge tone={statusTone(run.status)} dot live={isActive(run.status)}>
              {statusText[run.status] || run.status}
            </Badge>
          )}
          {run?.config.simulated && <Badge tone="warning">模拟 · 未真实执行</Badge>}
        </div>
      }
      footer={
        run && (
          <>
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={"/api/runs/" + run.id + "/report?format=md"}
            >
              <Download />
              Markdown
            </a>
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={"/api/runs/" + run.id + "/report?format=json"}
            >
              <Download />
              JSON
            </a>
            <span className="spacer" />
            {run.pr_url && (
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={run.pr_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink />
                PR
              </a>
            )}
            <Link
              className={buttonVariants({ size: "sm" })}
              to={"/agent?run=" + run.id}
              onClick={onClose}
            >
              <Bot />在 Agent 页打开
            </Link>
          </>
        )
      }
      onClose={onClose}
    >
      {detail.error && <Notice error>{detail.error}</Notice>}
      {!run && !detail.error && <Empty>正在读取运行详情…</Empty>}
      {run && (
        <>
          <div
            className="kv-grid"
            style={{ gridTemplateColumns: "repeat(4, 1fr)", margin: "8px 0 12px" }}
          >
            <div>
              <span>权限</span>
              <b>{run.config.preset}</b>
            </div>
            <div>
              <span>分支</span>
              <b className="mono" title={run.branch}>
                {run.branch || "—"}
              </b>
            </div>
            <div>
              <span>提交</span>
              <b className="mono">{shortSha(run.commit_sha) || "—"}</b>
            </div>
            <div>
              <span>Token</span>
              <b className="num">{run.tokens.toLocaleString()}</b>
            </div>
          </div>
          <div className="actions" style={{ marginBottom: 8 }}>
            <Badge tone={run.hash_valid ? "success" : "warning"}>
              <ShieldCheck size={12} />
              {run.hash_valid ? "哈希链校验通过" : "哈希链未通过"}
            </Badge>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            label="运行详情"
            items={[
              { value: "timeline", label: "时间线", badge: <Badge small tone="muted">{run.events?.length ?? 0}</Badge> },
              { value: "diff", label: "Diff" },
            ]}
          />
          <div style={{ paddingTop: 14 }}>
            {tab === "timeline" ? (
              <ol className="timeline">
                {(run.events || []).map((e) => (
                  <li key={e.id}>
                    <span className="node" />
                    <div className="what">
                      <Badge mono small>
                        {e.kind}
                      </Badge>{" "}
                      <span className="sub ellipsis">{eventSummary(e)}</span>
                    </div>
                    <span className="when">{timeText(e.created)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <DiffView text={run.diff} />
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

export default function Runs() {
  const s = useStore();
  const runs = useResource<Run[]>("/repos/" + s.repo!.id + "/runs", 5000);
  const signedIn = !!s.session?.user;
  const audits = useResource<Audit[]>(signedIn ? "/audit" : null, 5000);
  const [tab, setTab] = useState<"runs" | "audit">("runs");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RunFilter>("all");
  const [auditQuery, setAuditQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [args, setArgs] = useState<Audit | null>(null);

  const runRows = (runs.data || []).filter(
    (r) =>
      matches(r, filter) &&
      (!query ||
        (r.task.title + r.id).toLowerCase().includes(query.toLowerCase())),
  );
  const auditRows = (audits.data || []).filter(
    (a) =>
      !auditQuery ||
      (a.action + a.actor).toLowerCase().includes(auditQuery.toLowerCase()),
  );
  const runTable = useFitPage(runRows, 46, 36);
  const auditTable = useFitPage(auditRows, 46, 36);
  const table = tab === "runs" ? runTable : auditTable;

  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title="运行记录与审计"
        description="读取数据库中的执行产物、审批记录和事件哈希链。点击一行查看详情。"
      >
        {signedIn && (
          <a
            className={buttonVariants({ variant: "outline" })}
            href="/api/audit/export"
          >
            <Download />
            导出 CSV
          </a>
        )}
      </PageHeader>
      <div className="page-body">
        {(runs.error || audits.error) && (
          <Notice error>{runs.error || audits.error}</Notice>
        )}
        <Tabs
          value={tab}
          onChange={setTab}
          label="记录类型"
          items={[
            {
              value: "runs",
              label: "运行记录",
              badge: (
                <Badge small tone="muted">
                  {runs.data?.length ?? 0}
                </Badge>
              ),
            },
            {
              value: "audit",
              label: "审计日志",
              badge: (
                <Badge small tone="muted">
                  {audits.data?.length ?? 0}
                </Badge>
              ),
            },
          ]}
        />
        <Card flex className="fill-row">
          <div className="toolbar">
            {tab === "runs" ? (
              <>
                <SearchInput
                  aria-label="搜索运行"
                  placeholder="搜索任务或运行 ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Segmented
                  label="状态筛选"
                  value={filter}
                  onChange={setFilter}
                  items={[
                    { value: "all", label: "全部" },
                    { value: "active", label: "运行中" },
                    { value: "completed", label: "已完成" },
                    { value: "other", label: "其他" },
                  ]}
                />
              </>
            ) : (
              <>
                <SearchInput
                  aria-label="筛选审计"
                  placeholder="按操作或操作人筛选"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                />
              </>
            )}
          </div>
          <div className="fit-area" ref={table.ref}>
            {tab === "audit" && !signedIn ? (
              <Empty
                icon={<ShieldCheck />}
                title="审计日志需要登录"
                action={
                  <a
                    className={buttonVariants({ size: "sm" })}
                    href="/api/auth/github/login"
                  >
                    使用 GitHub 登录
                  </a>
                }
              >
                访客模式不能查看审计日志。
              </Empty>
            ) : table.total === 0 ? (
              <Empty
                title={
                  (tab === "runs" ? runs.data : audits.data)?.length
                    ? "没有匹配的记录"
                    : "暂无记录"
                }
              >
                {tab === "runs"
                  ? "在 Agent 运行页启动任务后，记录会出现在这里。"
                  : "关键操作会自动写入审计日志。"}
              </Empty>
            ) : tab === "runs" ? (
              <table className="data-table live-table">
                <colgroup>
                  <col style={{ width: 120 }} />
                  <col />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 88 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 168 }} />
                </colgroup>
                <thead>
                  <tr>
                    {["运行", "任务", "状态", "Token", "提交", "开始时间"].map(
                      (t) => (
                        <th key={t} className={t === "Token" ? "t-right" : undefined}>
                          {t}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {runTable.visible.map((r, i) => (
                    <tr
                      key={r.id}
                      className="click"
                      tabIndex={0}
                      style={{ animationDelay: i * 18 + "ms" }}
                      onClick={() => setOpen(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setOpen(r.id);
                      }}
                    >
                      <td>
                        <span className="mono link">{r.id}</span>
                      </td>
                      <td>
                        <span className="row-title">{r.task.title}</span>
                        <span className="sub">{r.config.simulated ? "模拟" : r.config.preset}</span>
                      </td>
                      <td>
                        <Badge tone={statusTone(r.status)} dot live={isActive(r.status)}>
                          {statusText[r.status] || r.status}
                        </Badge>
                      </td>
                      <td className="t-right num">{r.tokens.toLocaleString()}</td>
                      <td>
                        {r.commit_sha ? (
                          <Badge mono>{shortSha(r.commit_sha)}</Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted num">{dateText(r.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="data-table live-table">
                <colgroup>
                  <col style={{ width: 188 }} />
                  <col style={{ width: 160 }} />
                  <col />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr>
                    {["时间", "操作人", "操作", ""].map((t, i) => (
                      <th key={i}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditTable.visible.map((a, i) => (
                    <tr key={a.id} style={{ animationDelay: i * 18 + "ms" }}>
                      <td className="muted num">{dateText(a.created)}</td>
                      <td>{a.actor}</td>
                      <td>
                        <Badge mono>{a.action}</Badge>
                      </td>
                      <td className="t-right">
                        <Button variant="ghost" size="sm" onClick={() => setArgs(a)}>
                          查看参数
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card-foot">
            <span>
              {table.total
                ? "第 " +
                  (table.page * table.size + 1) +
                  "–" +
                  Math.min(table.total, (table.page + 1) * table.size) +
                  " 条，共 " +
                  table.total +
                  " 条"
                : "—"}
            </span>
            <Pager
              page={table.page}
              size={table.size}
              total={table.total}
              onChange={table.setPage}
            />
          </div>
        </Card>
      </div>
      {open && <RunSheet id={open} onClose={() => setOpen(null)} />}
      {args && (
        <Dialog
          title={args.action}
          description={dateText(args.created) + " · " + args.actor}
          onClose={() => setArgs(null)}
        >
          <Code text={JSON.stringify(args.detail, null, 2)} />
        </Dialog>
      )}
    </Page>
  );
}
