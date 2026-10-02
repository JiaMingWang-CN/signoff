import { clsx, type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

export const dateText = (value: string) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";

export const statusText: Record<string, string> = {
  importing: "导入中",
  ready: "已就绪",
  error: "失败",
  running: "运行中",
  starting: "准备中",
  waiting: "等待审批",
  completed: "完成",
  complete: "完成",
  failed: "失败",
  needs_review: "需要审核",
  accepted: "已通过审核",
  rejected: "已驳回",
  stopped: "已停止",
  interrupted: "已中断",
  open: "待处理",
  ignored: "已忽略",
  planned: "已排期",
  applied: "已应用",
  preview: "预览",
  draft: "待确认",
};

export type Tone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  | "muted"
  | "solid-danger";

// Badge tone and the round status marker that go with a run / repo / scan status.
export function statusTone(status: string): Tone {
  switch (status) {
    case "completed":
    case "complete":
    case "accepted":
    case "ready":
    case "applied":
      return "success";
    case "running":
    case "starting":
    case "importing":
      return "info";
    case "waiting":
    case "needs_review":
    case "draft":
    case "preview":
      return "warning";
    case "failed":
    case "error":
      return "danger";
    case "rejected":
    case "stopped":
    case "interrupted":
    case "ignored":
      return "muted";
    case "planned":
      return "brand";
    default:
      return "default";
  }
}

export type DotKind = "ok" | "run" | "fail" | "wait" | "off";
export function statusDot(status: string): DotKind {
  const tone = statusTone(status);
  return tone === "success"
    ? "ok"
    : tone === "info"
      ? "run"
      : tone === "danger"
        ? "fail"
        : tone === "warning"
          ? "wait"
          : "off";
}

export const isActive = (status?: string) =>
  !!status && ["starting", "running", "waiting"].includes(status);

export const severityTone = (severity: string): Tone =>
  severity === "critical"
    ? "solid-danger"
    : severity === "high"
      ? "danger"
      : severity === "low" || severity === "unknown"
        ? "default"
        : "warning";

export const shortSha = (sha: string, n = 7) => (sha ? sha.slice(0, n) : "");
