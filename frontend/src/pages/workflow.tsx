import { Check, ChevronRight, Lock, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api, type Plan, type Scan } from "../api";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { cn } from "../lib/utils";
import { Alert, Badge, Button, BusyButton, Dialog } from "../components";

export type StepState = "done" | "current" | "locked";
export type Step = {
  key: "scan" | "plan" | "schedule";
  label: string;
  to: string;
  state: StepState;
};

// Work goes scan → plan → schedule. A step is done once its result exists, the
// first unfinished one is where to go next, and later ones wait for it.
export function useWorkflow() {
  const s = useStore();
  const scans = useResource<Scan[]>("/repos/" + s.repo!.id + "/scans", 4000);
  const plans = useResource<Plan[]>("/repos/" + s.repo!.id + "/plans", 4000);
  const done = {
    scan: !!scans.data?.some((x) => x.status === "complete"),
    plan: !!plans.data?.some((p) => p.status === "draft" || p.status === "applied"),
    schedule: !!plans.data?.some((p) => p.status === "applied"),
  };
  const order = ["scan", "plan", "schedule"] as const;
  const next = order.find((k) => !done[k]);
  const steps: Step[] = [
    { key: "scan", label: "扫描", to: "/security" },
    { key: "plan", label: "规划", to: "/planning" },
    { key: "schedule", label: "排期", to: "/calendar" },
  ].map((step) => ({
    ...(step as Omit<Step, "state">),
    state: done[step.key as keyof typeof done]
      ? "done"
      : step.key === next
        ? "current"
        : "locked",
  }));
  return {
    steps,
    done,
    next: steps.find((x) => x.state === "current"),
    plans: plans.data || [],
    reload: () => {
      scans.reload();
      plans.reload();
    },
  };
}

export function WorkflowSteps({ steps }: { steps: Step[] }) {
  return (
    <nav className="workflow-steps" aria-label="工作流程">
      {steps.map((step, i) => {
        const body = (
          <>
            <span className="n">
              {step.state === "done" ? (
                <Check />
              ) : step.state === "locked" ? (
                <Lock />
              ) : (
                i + 1
              )}
            </span>
            {step.label}
          </>
        );
        return (
          <span key={step.key} className="step-wrap">
            {i > 0 && <ChevronRight className="sep" />}
            {step.state === "locked" ? (
              <span
                className={cn("step", step.state)}
                aria-disabled="true"
                title="先完成前一步"
              >
                {body}
              </span>
            ) : (
              <Link
                className={cn("step", step.state)}
                to={step.to}
                aria-current={step.state === "current" ? "step" : undefined}
              >
                {body}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// Starts the work over: removes every plan, schedule and version of this repo.
export function ClearPlans({
  plans,
  onCleared,
}: {
  plans: Plan[];
  onCleared: () => void;
}) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const applied = plans.filter((p) => p.status === "applied").length;
  return (
    <>
      <Button
        variant="outline"
        disabled={!plans.length}
        title={plans.length ? undefined : "还没有规划或排期"}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        清空规划与排期
      </Button>
      {open && (
        <Dialog
          size="narrow"
          title="清空规划与排期？"
          description={
            "将永久删除 " +
            plans.length +
            " 个规划版本" +
            (applied ? "（其中 " + applied + " 个已排期）" : "") +
            "，不可撤销。"
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <BusyButton
                label="clear"
                variant="danger"
                onClick={() =>
                  void s
                    .perform("clear", () =>
                      api<{ deleted: number }>(
                        "/repos/" + s.repo!.id + "/plans",
                        undefined,
                        "DELETE",
                      ),
                    )
                    .then((result) => {
                      if (!result) return;
                      setOpen(false);
                      s.notify("已清空 " + result.deleted + " 个规划版本，可以从规划重新开始");
                      onCleared();
                    })
                }
              >
                清空
              </BusyButton>
            </>
          }
          onClose={() => setOpen(false)}
        >
          <Alert tone="warning">
            任务拆分、容量设置、日历排期和版本历史都会被删除。漏洞扫描结果、Issue 和 Agent
            运行记录不受影响。
          </Alert>
          <p className="muted small" style={{ marginTop: 12 }}>
            清空后按 <Badge small>扫描</Badge> → <Badge small>规划</Badge> →{" "}
            <Badge small>排期</Badge> 的顺序重新来。
          </p>
        </Dialog>
      )}
    </>
  );
}
