// 首页展示用的虚拟数据。接入后端前，所有数字、仓库与运行记录都来自这里。

export const repo = {
  name: "aurora/notes-api",
  branch: "main",
  files: 312,
  symbols: 12481,
  edges: 48207,
};

export const heroVerbs = ["检索", "扫描", "排期", "修复", "测试", "提交"];

// 流水线传送带上的工作项：穿过每道关卡时依次显示对应字段
export type BeltItem = {
  src: string;
  title: string;
  sev: string;
  level: Severity | "feature";
  task: string;
  owner: "human" | "agent";
  add: number;
  del: number;
  tests: number;
  pr: number;
};

export const beltRows: BeltItem[][] = [
  [
    { src: "Issue #212", title: "搜索含单引号时返回 500", sev: "high · SEC-5", level: "high", task: "T2 · 2h · Agent", owner: "agent", add: 2, del: 2, tests: 17, pr: 48 },
    { src: "requirements.txt", title: "requests 2.25 证书校验可被绕过", sev: "critical · SEC-39", level: "critical", task: "T1 · 3h · Agent", owner: "agent", add: 1, del: 1, tests: 17, pr: 49 },
    { src: "Issue #198", title: "导出文件名含空格时失败", sev: "high · SEC-3", level: "high", task: "T3 · 2h · Agent", owner: "agent", add: 6, del: 3, tests: 19, pr: 50 },
    { src: "app/config.py:7", title: "疑似硬编码的 SECRET_KEY", sev: "high · SEC-2", level: "high", task: "T6 · 1h · Agent", owner: "agent", add: 4, del: 1, tests: 17, pr: 51 },
    { src: "Issue #205", title: "搜索结果排序不稳定", sev: "medium · 需评审", level: "medium", task: "T8 · 4h · 人", owner: "human", add: 12, del: 5, tests: 21, pr: 52 },
  ],
  [
    { src: "app/importer.py:13", title: "yaml.load 未指定 Loader", sev: "medium · B506", level: "medium", task: "T4 · 2h · Agent", owner: "agent", add: 1, del: 1, tests: 18, pr: 53 },
    { src: "Issue #187", title: "按标签筛选笔记", sev: "feature · 新功能", level: "feature", task: "T7 · 4h · Agent", owner: "agent", add: 38, del: 4, tests: 24, pr: 54 },
    { src: "app/auth.py:23", title: "密码使用无盐 MD5", sev: "high · SEC-55", level: "high", task: "T5 · 3h · Agent", owner: "agent", add: 9, del: 2, tests: 20, pr: 55 },
    { src: "requirements.txt", title: "Werkzeug 调试器可远程执行", sev: "high · SEC-11", level: "high", task: "T3 · 1h · Agent", owner: "agent", add: 1, del: 1, tests: 17, pr: 56 },
    { src: "Issue #176", title: "README 缺少本地开发说明", sev: "low · 文档", level: "low", task: "T9 · 2h · 人", owner: "human", add: 26, del: 0, tests: 17, pr: 57 },
  ],
];

export const beltGates = ["扫描", "排期", "修复", "测试", "提交"];
export const beltStates = ["待处理", "已扫描", "已排期", "已修复", "已验证", "已合并"];

export const stats = [
  { value: 12481, label: "符号已建立索引", suffix: "" },
  { value: 247, label: "Issue 全文可检索", suffix: "" },
  { value: 38, label: "漏洞经 LLM 复核", suffix: "" },
  { value: 100, label: "运行事件可校验", suffix: "%" },
];

export type Severity = "critical" | "high" | "medium" | "low";

export const searchResults = [
  { kind: "fn", name: "search_notes", file: "notes/search.py", line: 42 },
  { kind: "fn", name: "parse_query", file: "notes/query.py", line: 17 },
  { kind: "class", name: "NoteIndex", file: "notes/index.py", line: 9 },
  { kind: "fn", name: "rank_results", file: "notes/search.py", line: 88 },
];

export const findings: {
  id: string;
  title: string;
  where: string;
  severity: Severity;
  verdict: "确认" | "疑似误报";
}[] = [
  {
    id: "GHSA-9wx4-h78v-vm56",
    title: "requests < 2.32 证书校验绕过",
    where: "requirements.txt",
    severity: "critical",
    verdict: "确认",
  },
  {
    id: "OWB-SQL-002",
    title: "SQL 字符串拼接",
    where: "notes/store.py:131",
    severity: "high",
    verdict: "确认",
  },
  {
    id: "B506",
    title: "yaml.load 未指定 Loader",
    where: "notes/config.py:22",
    severity: "medium",
    verdict: "确认",
  },
  {
    id: "OWB-SECRET-001",
    title: "疑似硬编码密钥",
    where: "tests/fixtures.py:8",
    severity: "low",
    verdict: "疑似误报",
  },
];

export const tasks: {
  id: number;
  title: string;
  hours: number;
  owner: "human" | "agent";
  priority: number;
}[] = [
  { id: 1, title: "升级 requests 并补回归测试", hours: 3, owner: "agent", priority: 0 },
  { id: 2, title: "参数化查询替换拼接 SQL", hours: 5, owner: "agent", priority: 0 },
  { id: 3, title: "评审搜索排序的产品取舍", hours: 4, owner: "human", priority: 1 },
  { id: 4, title: "yaml.safe_load 迁移", hours: 2, owner: "agent", priority: 2 },
  { id: 5, title: "回复 #212 并关闭重复 Issue", hours: 1, owner: "human", priority: 3 },
];

// 日历泳道：起止为 0–9 的工作日列
export const lanes = {
  human: [
    { task: 3, start: 0, span: 2, label: "#3 排序取舍" },
    { task: 5, start: 3, span: 1, label: "#5 回复" },
  ],
  agent: [
    { task: 1, start: 0, span: 1, label: "#1 requests" },
    { task: 2, start: 1, span: 2, label: "#2 参数化 SQL" },
    { task: 4, start: 3, span: 1, label: "#4 safe_load" },
  ],
};

export const diff = [
  { t: "ctx", s: "def find_notes(db, keyword):" },
  { t: "del", s: '    sql = f"SELECT * FROM notes WHERE body LIKE \'%{keyword}%\'"' },
  { t: "del", s: "    return db.execute(sql).fetchall()" },
  { t: "add", s: '    sql = "SELECT * FROM notes WHERE body LIKE ?"' },
  { t: "add", s: '    return db.execute(sql, (f"%{keyword}%",)).fetchall()' },
] as const;

export const pipeline = [
  {
    key: "search",
    no: "01",
    title: "检索",
    en: "Search",
    body: "codegraph 给出符号、调用路径与源码上下文；Issue 走 FTS5 全文检索。问 AI 时，Agent 自己去查。",
  },
  {
    key: "scan",
    no: "02",
    title: "扫描",
    en: "Scan",
    body: "OSV 依赖漏洞 + 按语言区分的内置规则 + bandit / semgrep，每一条都可交给 LLM 复核。",
  },
  {
    key: "assign",
    no: "03",
    title: "分工",
    en: "Assign",
    body: "Agent 汇总问题、拆成任务并估时，然后逐条问你：这件事由你做，还是交给它？",
  },
  {
    key: "plan",
    no: "04",
    title: "排期",
    en: "Schedule",
    body: "确定性算法按依赖、优先级与容量排进人和 Agent 两条泳道。一句话就能调整，先预览再应用。",
  },
  {
    key: "run",
    no: "05",
    title: "修复",
    en: "Execute",
    body: "独立 git worktree 中读写、编辑、运行测试。危险操作暂停等待审批，随时可以叫停。",
  },
  {
    key: "ship",
    no: "06",
    title: "提交",
    en: "Ship",
    body: "真实 diff、完整测试输出、哈希链校验通过之后，由你按下按钮，才会推送分支并创建 PR。",
  },
] as const;

export type GraphKind = "file" | "class" | "fn" | "test";
export const graphNodes: { id: string; kind: GraphKind; file: string }[] = [
  { id: "app.py", kind: "file", file: "notes/app.py" },
  { id: "search.py", kind: "file", file: "notes/search.py" },
  { id: "store.py", kind: "file", file: "notes/store.py" },
  { id: "config.py", kind: "file", file: "notes/config.py" },
  { id: "auth.py", kind: "file", file: "notes/auth.py" },
  { id: "create_app", kind: "fn", file: "notes/app.py" },
  { id: "register_routes", kind: "fn", file: "notes/app.py" },
  { id: "search_notes", kind: "fn", file: "notes/search.py" },
  { id: "parse_query", kind: "fn", file: "notes/query.py" },
  { id: "rank_results", kind: "fn", file: "notes/search.py" },
  { id: "tokenize", kind: "fn", file: "notes/query.py" },
  { id: "NoteIndex", kind: "class", file: "notes/index.py" },
  { id: "NoteIndex.build", kind: "fn", file: "notes/index.py" },
  { id: "NoteIndex.lookup", kind: "fn", file: "notes/index.py" },
  { id: "NoteStore", kind: "class", file: "notes/store.py" },
  { id: "find_notes", kind: "fn", file: "notes/store.py" },
  { id: "save_note", kind: "fn", file: "notes/store.py" },
  { id: "delete_note", kind: "fn", file: "notes/store.py" },
  { id: "connect", kind: "fn", file: "notes/store.py" },
  { id: "load_config", kind: "fn", file: "notes/config.py" },
  { id: "read_env", kind: "fn", file: "notes/config.py" },
  { id: "verify_token", kind: "fn", file: "notes/auth.py" },
  { id: "hash_password", kind: "fn", file: "notes/auth.py" },
  { id: "Session", kind: "class", file: "notes/auth.py" },
  { id: "cli_main", kind: "fn", file: "notes/cli.py" },
  { id: "export_md", kind: "fn", file: "notes/export.py" },
  { id: "render_note", kind: "fn", file: "notes/export.py" },
  { id: "test_search", kind: "test", file: "tests/test_search.py" },
  { id: "test_store", kind: "test", file: "tests/test_store.py" },
  { id: "test_auth", kind: "test", file: "tests/test_auth.py" },
  { id: "test_export", kind: "test", file: "tests/test_export.py" },
  { id: "highlight", kind: "fn", file: "notes/search.py" },
  { id: "paginate", kind: "fn", file: "notes/search.py" },
  { id: "migrate", kind: "fn", file: "notes/store.py" },
];

export const graphEdges: [string, string][] = [
  ["app.py", "create_app"],
  ["app.py", "register_routes"],
  ["search.py", "search_notes"],
  ["search.py", "rank_results"],
  ["search.py", "highlight"],
  ["search.py", "paginate"],
  ["store.py", "NoteStore"],
  ["store.py", "find_notes"],
  ["store.py", "migrate"],
  ["config.py", "load_config"],
  ["config.py", "read_env"],
  ["auth.py", "verify_token"],
  ["auth.py", "Session"],
  ["create_app", "register_routes"],
  ["create_app", "load_config"],
  ["create_app", "connect"],
  ["create_app", "migrate"],
  ["register_routes", "search_notes"],
  ["register_routes", "save_note"],
  ["register_routes", "delete_note"],
  ["register_routes", "verify_token"],
  ["register_routes", "export_md"],
  ["search_notes", "parse_query"],
  ["search_notes", "rank_results"],
  ["search_notes", "find_notes"],
  ["search_notes", "NoteIndex.lookup"],
  ["search_notes", "highlight"],
  ["search_notes", "paginate"],
  ["parse_query", "tokenize"],
  ["NoteIndex", "NoteIndex.build"],
  ["NoteIndex", "NoteIndex.lookup"],
  ["NoteIndex.build", "tokenize"],
  ["NoteIndex.build", "find_notes"],
  ["NoteStore", "find_notes"],
  ["NoteStore", "save_note"],
  ["NoteStore", "delete_note"],
  ["NoteStore", "connect"],
  ["save_note", "NoteIndex.build"],
  ["load_config", "read_env"],
  ["verify_token", "Session"],
  ["Session", "hash_password"],
  ["cli_main", "create_app"],
  ["cli_main", "export_md"],
  ["export_md", "render_note"],
  ["export_md", "find_notes"],
  ["render_note", "highlight"],
  ["test_search", "search_notes"],
  ["test_search", "parse_query"],
  ["test_store", "save_note"],
  ["test_store", "find_notes"],
  ["test_auth", "verify_token"],
  ["test_auth", "hash_password"],
  ["test_export", "export_md"],
];

export type RunLine = {
  t: string;
  kind: "sys" | "tool" | "ok" | "warn" | "ask" | "out";
  text: string;
};

export const runLines: RunLine[] = [
  { t: "00:00.0", kind: "sys", text: "worktree owb/r-7f3a · base main@c41e9d2" },
  { t: "00:01.4", kind: "tool", text: "codegraph explore \"find_notes SQL 拼接\"" },
  { t: "00:03.2", kind: "tool", text: "read_file notes/store.py:120-140" },
  { t: "00:05.9", kind: "tool", text: "edit notes/store.py  −2  +2" },
  { t: "00:06.1", kind: "ask", text: "需要审批 · bash  pytest -q tests/test_store.py" },
  { t: "00:08.0", kind: "ok", text: "已批准 · 由你确认" },
  { t: "00:11.7", kind: "out", text: "17 passed in 2.31s" },
  { t: "00:12.0", kind: "ok", text: "运行完成 · 待你审核 diff" },
];

export const hashChain = [
  "a3f9c1e07b",
  "5d02e8aa41",
  "c7b14f9903",
  "19e6d0b2fe",
  "e84a7c3d10",
  "7ab2f05c96",
];

export const bento = [
  {
    key: "perm",
    title: "四档权限",
    body: "只读 · 逐步审批 · 工作区内自动 · 完全权限，再细到每个工具允许 / 询问 / 禁止。",
    meta: "PERMISSION",
  },
  {
    key: "chain",
    title: "哈希链审计",
    body: "每个运行事件串成 SHA-256 链，报告导出 Markdown / JSON 时逐条校验。",
    meta: "AUDIT",
  },
  {
    key: "nl",
    title: "一句话调期",
    body: "“周五不排任务，#3 改由我来做”——先出日历 diff，确认后才应用，可回到任一版本。",
    meta: "RESCHEDULE",
  },
  {
    key: "local",
    title: "本机运行",
    body: "Windows / Linux 一条命令启动。SQLite 默认，PostgreSQL 可切换，密钥不进前端。",
    meta: "LOCAL-FIRST",
  },
  {
    key: "llm",
    title: "任意 OpenAI 兼容模型",
    body: "OpenAI、DeepSeek、Qwen……在设置页填 Base URL 即可。",
    meta: "BYO MODEL",
  },
] as const;
