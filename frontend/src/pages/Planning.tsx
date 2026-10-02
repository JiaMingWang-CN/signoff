import { CalendarPlus, ListChecks, Plus, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Capacity, type Plan, type Task } from "../api";
import { useFitPage } from "../lib/fit";
import { ClearPlans, useWorkflow, WorkflowSteps } from "./workflow";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  BusyButton,
  Card,
  CardBody,
  CardHeader,
  ChipToggle,
  Dialog,
  Empty,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  Pager,
  Select,
  buttonVariants,
} from "../components";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export default function Planning() {
  const s = useStore();
  const navigate = useNavigate();
  const plans = useResource<Plan[]>("/repos/" + s.repo!.id + "/plans");
  const flow = useWorkflow();
  const base = plans.data?.[0];
  const [tasks, setTasks] = useState<Task[]>([]);
  const freshCapacity = (): Capacity => ({
    hours: 4,
    concurrency: 2,
    start: new Date().toLocaleDateString("en-CA"),
    weekdays: [1, 2, 3, 4, 5],
    blocked: [],
  });
  const [capacity, setCapacity] = useState<Capacity>(freshCapacity);
  const [blocked, setBlocked] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const table = useFitPage(tasks, 56, 36);
  useEffect(() => {
    if (base) {
      setTasks(base.tasks);
      setCapacity(base.capacity);
    }
  }, [base?.id]);
  async function draft() {
    const plan = await s.perform("plan", () =>
      api<Plan>("/repos/" + s.repo!.id + "/plan", {}),
    );
    if (plan) {
      setTasks(plan.tasks);
      setCapacity(plan.capacity);
      plans.reload();
    }
  }
  async function generate() {
    const plan = await s.perform("schedule", () =>
      api<Plan>("/repos/" + s.repo!.id + "/schedule", { tasks, capacity }),
    );
    if (plan) {
      s.notify("排期已保存到数据库");
      navigate("/calendar");
    }
  }
  const humanTasks = tasks.filter((t) => t.who === "human");
  const agentTasks = tasks.filter((t) => t.who === "agent");
  const human = humanTasks.reduce((sum, t) => sum + t.h, 0);
  const agent = agentTasks.reduce((sum, t) => sum + t.h, 0);
  function edit(id: string, update: Partial<Task>) {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, ...update } : t)));
  }
  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title="任务规划"
        description="Agent 汇总 Issue 和扫描发现，确认分工与容量后再生成排期。"
      >
        <WorkflowSteps steps={flow.steps} />
        <ClearPlans
          plans={flow.plans}
          onCleared={() => {
            setTasks([]);
            setCapacity(freshCapacity());
            plans.reload();
            flow.reload();
          }}
        />
        <BusyButton
          label="plan"
          variant="default"
          disabled={!flow.done.scan}
          onClick={() => void draft()}
        >
          <Wand2 />
          汇总问题并拆分任务
        </BusyButton>
      </PageHeader>
      <div className="page-body">
        {plans.error && <Notice error>{plans.error}</Notice>}
        {base?.summary && (
          <Notice
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSummaryOpen(true)}
              >
                查看全文
              </Button>
            }
          >
            <span className="clamp-1">{base.summary}</span>
          </Notice>
        )}
        <div className="cols planning-main fill-row">
          <Card flex>
            <CardHeader
              title={
                <>
                  任务拆分与估算
                  <Badge tone="muted" small>
                    {tasks.length}
                  </Badge>
                </>
              }
            />
            <div className="fit-area" ref={table.ref}>
              {tasks.length ? (
                <table className="data-table live-table">
                  <colgroup>
                    <col />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 104 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {["任务", "来源 / 依赖", "估算", "优先级", "执行方"].map(
                        (t) => (
                          <th key={t}>{t}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {table.visible.map((t, i) => (
                      <tr
                        key={t.id}
                        style={{ animationDelay: i * 18 + "ms", height: 56 }}
                      >
                        <td title={t.title + "\n" + t.why}>
                          <span className="row-title">
                            {t.id} {t.title}
                          </span>
                          <span className="sub">{t.why}</span>
                        </td>
                        <td>
                          <span className="row-title small">{t.src}</span>
                          <span className="sub">依赖 {t.dep}</span>
                        </td>
                        <td>
                          <span className="inline-unit">
                            <Input
                              className="input-sm compact-input"
                              type="number"
                              min="0.25"
                              max="1000"
                              step="0.25"
                              aria-label={t.id + "工时"}
                              value={t.h}
                              onChange={(e) =>
                                edit(t.id, { h: Number(e.target.value) })
                              }
                            />
                            h
                          </span>
                        </td>
                        <td>
                          <Select
                            className="select-sm"
                            aria-label={t.id + "优先级"}
                            value={t.priority}
                            onChange={(e) =>
                              edit(t.id, { priority: Number(e.target.value) })
                            }
                          >
                            {[0, 1, 2, 3, 4].map((value) => (
                              <option key={value} value={value}>
                                P{value}
                                {value === 0
                                  ? " 最高"
                                  : value === 4
                                    ? " 最低"
                                    : ""}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td>
                          <Select
                            className="select-sm"
                            aria-label={t.id + "执行方"}
                            value={t.who}
                            onChange={(e) =>
                              edit(t.id, { who: e.target.value as Task["who"] })
                            }
                          >
                            <option value="human">人</option>
                            <option value="agent">Agent</option>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty
                  icon={<ListChecks />}
                  title="还没有任务"
                  action={
                    flow.done.scan ? (
                      <BusyButton
                        label="plan"
                        variant="default"
                        size="sm"
                        onClick={() => void draft()}
                      >
                        汇总问题并拆分任务
                      </BusyButton>
                    ) : (
                      <Link
                        className={buttonVariants({ size: "sm" })}
                        to="/security"
                      >
                        先去扫描
                      </Link>
                    )
                  }
                >
                  {flow.done.scan
                    ? "让 Agent 把扫描发现和 Issue 汇总成任务。"
                    : "规划基于扫描结果。请先在“漏洞分析”完成一次扫描。"}
                </Empty>
              )}
            </div>
            {tasks.length > 0 && (
              <div className="card-foot">
                <span>点击估算、优先级、执行方即可修改</span>
                <Pager
                  page={table.page}
                  size={table.size}
                  total={tasks.length}
                  onChange={table.setPage}
                />
              </div>
            )}
          </Card>
          <div className="stack">
            <div className="duo">
              <Card className="stat static">
                <div className="label">
                  <Badge tone="brand">人 {humanTasks.length} 项</Badge>
                </div>
                <div className="value">{human}h</div>
                <div className="foot">
                  约 {Math.ceil(human / capacity.hours) || 0} 个工作日
                </div>
              </Card>
              <Card className="stat static">
                <div className="label">
                  <Badge tone="info">Agent {agentTasks.length} 项</Badge>
                </div>
                <div className="value">{agent}h</div>
                <div className="foot">
                  并发 {capacity.concurrency} · 每天最多 4h
                </div>
              </Card>
            </div>
            <Card flex className="grow">
              <CardHeader title="请确认可用时间与 Agent 资源" />
              <CardBody fill>
                <div className="form-grid">
                  <Field label="每天(h)">
                    <Input
                      aria-label="每天可投入"
                      type="number"
                      min="0.25"
                      max="24"
                      step="0.25"
                      value={capacity.hours}
                      onChange={(e) =>
                        setCapacity({
                          ...capacity,
                          hours: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Agent 并发">
                    <Input
                      aria-label="Agent 并发数"
                      type="number"
                      min="1"
                      max="8"
                      value={capacity.concurrency}
                      onChange={(e) =>
                        setCapacity({
                          ...capacity,
                          concurrency: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="开始日期" className="span-2">
                    <Input
                      aria-label="开始日期"
                      type="date"
                      value={capacity.start}
                      onChange={(e) =>
                        setCapacity({ ...capacity, start: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="field">
                  <span className="label">工作日</span>
                  <div className="actions wrap" style={{ gap: 6 }}>
                    {weekdays.map((day, index) => (
                      <ChipToggle
                        key={day}
                        aria-label={"周" + day}
                        checked={capacity.weekdays.includes(index)}
                        onChange={() =>
                          setCapacity({
                            ...capacity,
                            weekdays: capacity.weekdays.includes(index)
                              ? capacity.weekdays.filter((d) => d !== index)
                              : [...capacity.weekdays, index],
                          })
                        }
                      >
                        {day}
                      </ChipToggle>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="label">不可用日期</span>
                  <div className="actions">
                    <Input
                      type="date"
                      aria-label="不可用日期"
                      value={blocked}
                      onChange={(e) => setBlocked(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!blocked}
                      onClick={() => {
                        setCapacity({
                          ...capacity,
                          blocked: [...new Set([...capacity.blocked, blocked])],
                        });
                        setBlocked("");
                      }}
                    >
                      <Plus />
                      添加不可用日期
                    </Button>
                  </div>
                  {capacity.blocked.length > 0 && (
                    <div className="actions wrap" style={{ gap: 6 }}>
                      {capacity.blocked.map((day) => (
                        <button
                          type="button"
                          className="remove-chip mono"
                          key={day}
                          aria-label={"移除 " + day}
                          onClick={() =>
                            setCapacity({
                              ...capacity,
                              blocked: capacity.blocked.filter((d) => d !== day),
                            })
                          }
                        >
                          {day}
                          <X />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="push-bottom">
                  <p className="muted small">
                    日期由后端按依赖、优先级和容量确定性计算，估算和理由由 LLM
                    提供。
                  </p>
                  <BusyButton
                    label="schedule"
                    variant="brand"
                    disabled={!tasks.length}
                    onClick={() => void generate()}
                  >
                    <CalendarPlus />
                    确认，生成排期
                  </BusyButton>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
      {summaryOpen && base && (
        <Dialog title="规划摘要" onClose={() => setSummaryOpen(false)}>
          <p style={{ whiteSpace: "pre-wrap" }}>{base.summary}</p>
        </Dialog>
      )}
    </Page>
  );
}
