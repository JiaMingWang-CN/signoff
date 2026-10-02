export type Task = {
  id: string;
  title: string;
  why: string;
  src: string;
  dep: string;
  h: number;
  who: "human" | "agent";
  priority: number;
  not_before?: string | null;
  on?: string | null;
};
export type Capacity = {
  hours: number;
  concurrency: number;
  start: string;
  weekdays: number[];
  blocked: string[];
};
export type Scheduled = Task & { date: string; hours: number };
export type Issue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  html_url: string;
  comments_text: string;
};
export type LastSync = {
  mode?: "incremental" | "full" | "code";
  requested?: "incremental" | "full";
  trigger?: "manual" | "auto";
  at?: string;
  added?: number;
  updated?: number;
  removed?: number;
  total?: number;
  fell_back?: boolean;
  truncated?: boolean;
  duration?: number;
  error?: string;
};
export type Repo = {
  id: string;
  name: string;
  source: string;
  demo?: boolean;
  simulated?: boolean;
  message?: string;
  path: string;
  branch: string;
  sha: string;
  status: string;
  error: string;
  updated: string;
  syncing: boolean;
  issues_synced: string;
  last_sync: LastSync;
  issues: Issue[];
  progress: { step: string; status: string; output?: string; count?: number }[];
  stats: Record<string, unknown> & {
    file_count: number;
    fileCount?: number;
    nodeCount?: number;
    edgeCount?: number;
    initialized?: boolean;
    lastIndexed?: string;
    version?: string;
    nodesByKind?: Record<string, number>;
    index?: { state?: string; reindexRecommended?: boolean };
    languages: Record<string, number>;
  };
};
export type Finding = {
  id: string;
  title: string;
  severity: string;
  source: string;
  rule: string;
  file: string;
  line: number;
  code: string;
  suggestion: string;
  explanation?: string;
  review: string;
  status: string;
  // Set when the AI, not a person, ignored the finding; evidence is its stated fact.
  handled_by?: string;
  evidence?: string;
  url?: string;
};
export type Scan = {
  id: string;
  status: string;
  findings: Finding[];
  sources: {
    name: string;
    status: string;
    reason?: string;
    error?: string;
    packages?: number;
    done?: number;
    total?: number;
    unlocked?: string[];
  }[];
  error: string;
  sha: string;
  created: string;
};
export type Plan = {
  id: string;
  tasks: Task[];
  capacity: Capacity;
  calendar: Scheduled[];
  summary: string;
  status: string;
  version: number;
  created: string;
};
export type RunConfig = {
  simulated?: boolean;
  preset: string;
  tools: Record<string, string>;
  directory: string;
  full_confirmed: boolean;
  max_steps: number;
  max_tokens: number;
  test_command: string;
};
export type RunEvent = {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  hash: string;
  created: string;
};
export type Run = {
  id: string;
  repo_id: string;
  task: Task;
  config: RunConfig;
  status: string;
  path: string;
  branch: string;
  base_sha: string;
  commit_sha: string;
  diff: string;
  tests: { command?: string; output?: string; exit_code?: number | null; simulated?: boolean };
  tokens: number;
  error: string;
  created: string;
  finished: string;
  pr_url: string;
  events?: RunEvent[];
  hash_valid?: boolean;
};
export type Audit = {
  id: number;
  action: string;
  actor: string;
  detail: Record<string, unknown>;
  created: string;
};
export type Settings = {
  llm_base_url: string;
  llm_model: string;
  llm_configured: boolean;
  // Only ever typed into the form and sent; the server never returns it.
  llm_api_key?: string;
  workspace_dir: string;
  default_permission: string;
  bash_allow: string[];
  bash_deny: string[];
  // Per part of the app (review, plan, ask, agent); a missing key sends no effort.
  reasoning_effort?: Record<string, string>;
  sync_mode: "incremental" | "full";
  auto_sync_enabled: boolean;
  auto_sync_interval: number;
  max_steps: number;
  command_timeout: number;
  max_tokens: number;
  tools: Record<string, boolean>;
  database: string;
};
export type ConsoleTool = {
  name: string;
  label: string;
  kind: "read" | "write";
  description: string;
};
export type ConsoleCall = {
  id: string;
  function: { name: string; arguments: string };
};
export type ConsoleMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: ConsoleCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ConsolePermission = "readonly" | "approve" | "full";
export type ConsoleEffort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type Conversation = {
  id: string;
  title: string;
  permission: ConsolePermission;
  effort: ConsoleEffort;
  repo_id: string;
  status: "idle" | "running" | "waiting";
  messages: ConsoleMessage[];
  pending: { call_id?: string; tool?: string };
  allowed: string[];
  error: string;
  tokens: number;
  created: string;
  updated: string;
};
export const ENTRY_UNAVAILABLE = "暂未开放入口";

export type Session = {
  user: { login: string; avatar_url: string; html_url: string } | null;
  demo_repo: string;
  oauth_configured: boolean;
};
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  }
  return response.json();
}
