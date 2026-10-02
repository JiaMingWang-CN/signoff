import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  diffCalendars,
  formatPlacements,
  kindText,
} from "../lib/plan-diff";
import { Link, useNavigate } from "react-router";
import { api, type Plan, type Scheduled } from "../api";
import { useCapacity, useFitPage } from "../lib/fit";
import { ClearPlans, useWorkflow, WorkflowSteps } from "./workflow";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { cn, dateText } from "../lib/utils";
import {
  Badge,
  Button,
  BusyButton,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Empty,
  Markdown,
  Notice,
  Page,
  PageHeader,
  Pager,
  Segmented,
  Textarea,
} from "../components";

// Dates here come from the backend or localStorage; a malformed value must
// not turn into Invalid Date, which would throw in toISOString and blank
// the page.
function validISO(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(value + "T12:00:00Z").getTime());
}
function addDays(iso: string, days: number) {
  if (!validISO(iso)) return "";
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
// A calendar entry; ghosts are where a task used to be in the previewed plan.
type Entry = Scheduled & { ghost?: boolean };
const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// A lane / cell that shows as many tiles as fit and folds the rest into a
// "还有 n 项" link that opens the day.
function Tiles({
  items,
  tile,
  height,
  gap,
  reserve = 0,
  onMore,
  className,
  children,
}: {
  items: Entry[];
  tile: (t: Entry) => React.ReactNode;
  height: number;
  gap: number;
  reserve?: number;
  onMore: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const [ref, capacity] = useCapacity(height, gap, reserve);
  const fits = items.length <= capacity;
  const shown = fits ? items : items.slice(0, Math.max(0, capacity - 1));
  return (
    <div ref={ref} className={className}>
      {children}
      {shown.map(tile)}
      {!fits && (
        <button type="button" className="more-chip" onClick={onMore}>
          还有 {items.length - shown.length} 项
        </button>
      )}
    </div>
  );
}

function ChangeBlock({ change }: { change: ReturnType<typeof diffCalendars>[number] }) {
  return (
    <div className="change-block">
      <div>
        <span>之前</span>
        <b>{formatPlacements(change.before)}</b>
      </div>
      <div>
        <span>之后</span>
        <b>{formatPlacements(change.after)}</b>
      </div>
    </div>
  );
}

export default function Calendar() {
  const s = useStore();
  const navigate = useNavigate();
  const plans = useResource<Plan[]>("/repos/" + s.repo!.id + "/plans");
  const flow = useWorkflow();
  const current = plans.data?.find((p) => p.status === "applied");
  const [preview, setPreview] = useState<Plan | null>(null);
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState("");
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<Scheduled | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const plan = preview || current;
  useEffect(() => {
    if (!current || anchor) return;
    setAnchor(validISO(current.capacity.start) ? current.capacity.start : todayISO);
  }, [current?.id, anchor]);
  async function adjust() {
    const result = await s.perform("adjust", () =>
      api<Plan>("/plans/" + current!.id + "/adjust", { prompt }),
    );
    if (result) setPreview(result);
  }
  async function apply(id: string) {
    const result = await s.perform("apply", () =>
      api<Plan>("/plans/" + id + "/apply", {}),
    );
    if (result) {
      setPreview(null);
      plans.reload();
      s.notify("排期已保存");
    }
  }
  const first = anchor ? anchor.slice(0, 8) + "01" : "";
  const start = anchor
    ? mode === "week"
      ? addDays(
          anchor,
          -((new Date(anchor + "T12:00:00Z").getUTCDay() + 6) % 7),
        )
      : addDays(first, -((new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7))
    : "";
  const days = start
    ? Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) =>
        addDays(start, i),
      )
    : [];
  function changePeriod(direction: number) {
    if (mode === "week") setAnchor(addDays(anchor, direction * 7));
    else {
      const date = new Date(first + "T12:00:00Z");
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchor(date.toISOString().slice(0, 10));
    }
  }
  const todayISO = new Date().toLocaleDateString("en-CA");
  const today = todayISO;
  // A day outside the capacity's working weekdays is a rest day. Tasks that the
  // schedule or an adjustment placed on one are still shown.
  const isRest = (d: string) =>
    !!plan && !plan.capacity.weekdays.includes(new Date(d + "T12:00:00Z").getUTCDay());
  // What the previewed plan changes compared with the applied one.
  const changes = preview && current ? diffCalendars(current.calendar, preview.calendar) : [];
  const changedIds = new Set(changes.map((c) => c.id));
  const ghosts: Entry[] = changes.flatMap((c) =>
    c.removedFrom.map((t) => ({ ...t, ghost: true })),
  );
  const entries: Entry[] = plan ? [...plan.calendar, ...ghosts] : [];
  function tile(t: Entry, compact = false) {
    if (t.ghost)
      return (
        <div
          key={t.id + t.date + t.who + "-ghost"}
          className={cn("calendar-task ghost", t.who, compact && "compact")}
          title={t.id + " 原本排在这一天，预览中已移走"}
        >
          <strong>
            {t.id} · {t.hours}h
          </strong>
          <span>{compact ? "已移走" : "原位置，已移走"}</span>
        </div>
      );
    const changed =
      changedIds.has(t.id) &&
      !current?.calendar.some(
        (x) =>
          x.id === t.id &&
          x.date === t.date &&
          x.who === t.who &&
          x.hours === t.hours,
      );
    return (
      <button
        type="button"
        key={t.id + t.date + t.who}
        className={cn("calendar-task", t.who, changed && "changed", compact && "compact")}
        onClick={() => setTask(t)}
      >
        <strong>
          {t.id} · {t.hours}h
        </strong>
        {!compact && <span>{t.title}</span>}
        {compact && <span className="ellipsis">{t.title}</span>}
      </button>
    );
  }
  const finish = plan?.calendar
    .map((t) => t.date)
    .sort()
    .at(-1);
  const applied = plans.data?.filter((p) => p.status === "applied") || [];
  const versions = useFitPage(applied, 48);
  const dayTasks = day ? entries.filter((t) => t.date === day) : [];

  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title="任务日历"
        description={
          plan
            ? "v" + plan.version + " · 预计完成 " + (finish || "—")
            : "确认规划后生成任务日历"
        }
      >
        <WorkflowSteps steps={flow.steps} />
        <ClearPlans
          plans={flow.plans}
          onCleared={() => {
            setPreview(null);
            setAnchor("");
            plans.reload();
            flow.reload();
            navigate("/planning");
          }}
        />
        <Link className={buttonVariants({ variant: "outline" })} to="/planning">
          重新规划
        </Link>
      </PageHeader>
      <div className="page-body">
        {plans.error && <Notice error>{plans.error}</Notice>}
        {!plan ? (
          <Card flex className="fill-row">
            <Empty
              icon={<CalendarDays />}
              title="暂无已应用排期"
              action={
                <Link
                  className={buttonVariants({ size: "sm" })}
                  to={flow.next?.to || "/planning"}
                >
                  {flow.next?.key === "scan"
                    ? "先去扫描"
                    : flow.done.plan
                      ? "去生成排期"
                      : "去规划"}
                </Link>
              }
            >
              {flow.next?.key === "scan"
                ? "按“扫描 → 规划 → 排期”的顺序来，先在“漏洞分析”完成一次扫描。"
                : flow.done.plan
                  ? "已经有任务拆分，在规划页确认分工和容量后生成排期。"
                  : "先让 Agent 汇总问题并拆分任务，再生成日历。"}
            </Empty>
          </Card>
        ) : (
          <div className="cols calendar-layout fill-row">
            <Card flex>
              <div className="toolbar">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="上一期"
                  onClick={() => changePeriod(-1)}
                >
                  <ChevronLeft />
                </Button>
                <strong className="period num">
                  {days.length
                    ? mode === "week"
                      ? days[0] + " — " + days.at(-1)
                      : anchor.slice(0, 7)
                    : "—"}
                </strong>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下一期"
                  onClick={() => changePeriod(1)}
                >
                  <ChevronRight />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAnchor(plan.capacity.start)}
                >
                  回到开始
                </Button>
                <div className="spacer" />
                <div className="legend-inline">
                  <i className="human" />人<i className="agent" />Agent
                  <i className="rest" />休息日
                  <i className="changed" />修改后
                </div>
                <Segmented
                  label="视图"
                  value={mode}
                  onChange={setMode}
                  items={[
                    { value: "week", label: "周" },
                    { value: "month", label: "月" },
                  ]}
                />
              </div>
              {preview && (
                <div style={{ padding: "10px 16px 0" }}>
                  <Notice
                    action={
                      <div className="actions">
                        <BusyButton
                          label="apply"
                          variant="default"
                          size="sm"
                          onClick={() => void apply(preview.id)}
                        >
                          应用变更
                        </BusyButton>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPreview(null)}
                        >
                          放弃
                        </Button>
                      </div>
                    }
                  >
                    正在预览 v{preview.version}，尚未应用 ·{" "}
                    {changes.length
                      ? changes.length + " 项任务有变化"
                      : "没有任务发生变化"}
                    {changes.length > 0 && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link-more"
                          onClick={() => setChangesOpen(true)}
                        >
                          查看变更明细
                        </button>
                      </>
                    )}
                  </Notice>
                </div>
              )}
              {mode === "week" ? (
                <div className="calendar-grid">
                  <div className="cal-head" />
                  {days.map((d) => (
                    <div
                      className={cn(
                        "cal-head",
                        d === today && "today",
                        isRest(d) && "rest",
                      )}
                      key={d}
                    >
                      <strong className="num">{d.slice(5)}</strong>
                      <span className="muted small">
                        {weekdayNames[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7]}
                        {plan.capacity.blocked.includes(d) && " · 不可用"}
                      </span>
                      {isRest(d) && <span className="rest-tag">休息日</span>}
                    </div>
                  ))}
                  {(["human", "agent"] as const).map((who) => (
                    <section className="calendar-lane-row" key={who}>
                      <div className="lane-label">
                        <strong className={who}>
                          {who === "human" ? <User /> : <Bot />}
                          {who === "human" ? "人" : "Agent"}
                        </strong>
                        <span className="muted small">
                          {who === "human"
                            ? plan.capacity.hours + "h/天"
                            : "并发 " + plan.capacity.concurrency}
                        </span>
                      </div>
                      {days.map((d) => (
                        <Tiles
                          key={d}
                          className={cn(
                            "calendar-lane",
                            plan.capacity.blocked.includes(d) && "blocked",
                            isRest(d) && "rest",
                          )}
                          items={entries.filter(
                            (t) => t.date === d && t.who === who,
                          )}
                          tile={(t) => tile(t)}
                          height={44}
                          gap={6}
                          reserve={16}
                          onMore={() => setDay(d)}
                        />
                      ))}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="calendar-month-wrap">
                  <div className="month-head">
                    {weekdayNames.map((n) => (
                      <span key={n}>{n}</span>
                    ))}
                  </div>
                  <div className="calendar-month">
                    {days.map((d) => (
                      <Tiles
                        key={d}
                        className={cn(
                          d.slice(0, 7) !== anchor.slice(0, 7) && "outside",
                          d === today && "today",
                          isRest(d) && "rest",
                        )}
                        items={entries.filter((t) => t.date === d)}
                        tile={(t) => tile(t, true)}
                        height={22}
                        gap={2}
                        reserve={22}
                        onMore={() => setDay(d)}
                      >
                        <span className="day-row">
                          <strong className="num">{d.slice(8)}</strong>
                          {isRest(d) && <span className="rest-tag">休</span>}
                        </span>
                      </Tiles>
                    ))}
                  </div>
                </div>
              )}
              <div className="card-foot">
                <span>
                  依赖完成后的下一工作日开始；虚线为修改后的任务，灰色删除线为原位置。
                </span>
                <span className="mono">
                  {plan.calendar.length} 项 · {plan.capacity.start} 起
                </span>
              </div>
            </Card>
            <div className="stack">
              <Card>
                <CardHeader
                  title={
                    <>
                      <Sparkles style={{ color: "var(--brand)" }} />
                      用一句话调整排期
                    </>
                  }
                />
                <CardBody className="adjust-body">
                  <p className="muted small">
                    例如：周五不排任务，把 T3 改成我来做，安全任务优先。
                  </p>
                  <Textarea
                    aria-label="描述排期调整"
                    rows={4}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="actions">
                    <BusyButton
                      label="adjust"
                      variant="default"
                      disabled={!prompt.trim() || !current}
                      onClick={() => void adjust()}
                    >
                      预览变更
                    </BusyButton>
                  </div>
                  {preview?.summary && (
                    <div className="answer-box">
                      <Markdown text={preview.summary} />
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card flex className="history-card">
                <CardHeader
                  title={
                    <>
                      <History />
                      版本历史
                      <Badge tone="muted" small>
                        {applied.length}
                      </Badge>
                    </>
                  }
                />
                <div className="fit-area" ref={versions.ref}>
                  {versions.visible.map((p) => (
                    <div className="list-row" style={{ height: 48 }} key={p.id}>
                      <div className="actions">
                        <Badge tone={p.id === current?.id ? "success" : "default"}>
                          v{p.version}
                        </Badge>
                        <span className="small muted">{dateText(p.created)}</span>
                      </div>
                      {p.id === current?.id ? (
                        <span className="muted small">当前</span>
                      ) : (
                        <BusyButton
                          label="apply"
                          size="sm"
                          onClick={() => void apply(p.id)}
                        >
                          <RotateCcw />
                          恢复
                        </BusyButton>
                      )}
                    </div>
                  ))}
                </div>
                {applied.length > versions.size && (
                  <div className="card-foot">
                    <span>已应用版本</span>
                    <Pager
                      page={versions.page}
                      size={versions.size}
                      total={applied.length}
                      onChange={versions.setPage}
                    />
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
      {task && (
        <Dialog
          title={task.id + " · " + task.title}
          description={
            <>
              <Badge tone={task.who === "human" ? "brand" : "info"}>
                {task.who === "human" ? "人" : "Agent"}
              </Badge>{" "}
              <span className="mono">
                {task.date} · {task.hours}h
              </span>
            </>
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setTask(null)}>
                关闭
              </Button>
              <Button
                variant="brand"
                onClick={() => {
                  navigate("/agent?task=" + task.id);
                  setTask(null);
                }}
              >
                <Bot />
                交给 Agent 执行
              </Button>
            </>
          }
          onClose={() => setTask(null)}
        >
          <div className="kv-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div>
              <span>来源</span>
              <b title={task.src}>{task.src}</b>
            </div>
            <div>
              <span>依赖</span>
              <b>{task.dep}</b>
            </div>
            <div>
              <span>估算</span>
              <b>{task.h}h</b>
            </div>
          </div>
          {changes.find((c) => c.id === task.id) && (
            <>
              <h3>预览中的变化</h3>
              <ChangeBlock change={changes.find((c) => c.id === task.id)!} />
            </>
          )}
          <h3>理由</h3>
          <p>{task.why}</p>
        </Dialog>
      )}
      {changesOpen && preview && (
        <Dialog
          size="wide"
          title="变更明细"
          description={
            "预览 v" + preview.version + " 相对当前 v" + current!.version + "，共 " + changes.length + " 项任务有变化"
          }
          onClose={() => setChangesOpen(false)}
        >
          <div className="stack" style={{ gap: 14, paddingTop: 8 }}>
            {changes.map((c) => (
              <div key={c.id}>
                <div className="actions" style={{ marginBottom: 6 }}>
                  <Badge mono>{c.id}</Badge>
                  <strong>{c.title}</strong>
                  <Badge tone="warning">{kindText[c.kind]}</Badge>
                </div>
                <ChangeBlock change={c} />
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {day && (
        <Dialog
          size="narrow"
          title={day}
          description={dayTasks.length + " 个排期项"}
          onClose={() => setDay(null)}
        >
          <div className="stack">{dayTasks.map((t) => tile(t))}</div>
        </Dialog>
      )}
    </Page>
  );
}
