import { Check, LogIn, LogOut, Save, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Settings as SettingsData } from "../api";
import { useStore } from "../lib/store";
import {
  Alert,
  Badge,
  BusyButton,
  buttonVariants,
  Card,
  CardBody,
  CheckRow,
  Checkbox,
  Empty,
  Field,
  Input,
  Page,
  PageHeader,
  Segmented,
  Select,
  Switch,
  Tabs,
  Textarea,
} from "../components";

type Section = "llm" | "github" | "agent" | "sync" | "tools";

const efforts = ["low", "medium", "high", "xhigh", "max"];
const effortParts = [
  ["review", "AI 复核"],
  ["plan", "规划汇总与调整"],
  ["ask", "仓库问答"],
  ["agent", "Agent 运行"],
] as const;

const presets = [
  ["readonly", "只读"],
  ["approve", "逐步审批"],
  ["auto", "工作区内自动"],
  ["full", "完全权限"],
];

export default function Settings() {
  const s = useStore();
  const [fields, setFields] = useState<SettingsData | null>(s.settings);
  const [latency, setLatency] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [section, setSection] = useState<Section>("llm");
  // A reload from elsewhere (another page, a save) would silently discard
  // what the user is typing; edits win until they are saved or dropped.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setFields(s.settings);
  }, [s.settings]);
  // Guests receive only a few public settings, never the full form.
  if (s.session && !s.session.user)
    return (
      <Page>
        <Empty
          action={
            <a
              className={buttonVariants({ variant: "default" })}
              href="/api/auth/github/login"
            >
              <LogIn />
              使用 GitHub 登录
            </a>
          }
        >
          设置仅对登录用户开放，游客无权读取或修改服务配置。
        </Empty>
      </Page>
    );
  if (!fields)
    return (
      <Page>
        <Empty>正在读取服务配置…</Empty>
      </Page>
    );
  function field(update: Partial<SettingsData>) {
    dirty.current = true;
    setFields({ ...fields!, ...update });
  }
  async function save() {
    const result = await s.perform("settings", () =>
      api<SettingsData>(
        "/settings",
        {
          llm_base_url: fields!.llm_base_url,
          llm_model: fields!.llm_model,
          llm_api_key: fields!.llm_api_key ?? "",
          workspace_dir: fields!.workspace_dir,
          default_permission: fields!.default_permission,
          full_confirmed: full,
          bash_allow: fields!.bash_allow ?? [],
          bash_deny: fields!.bash_deny ?? [],
          reasoning_effort: fields!.reasoning_effort ?? {},
          sync_mode: fields!.sync_mode ?? "incremental",
          auto_sync_enabled: fields!.auto_sync_enabled ?? false,
          auto_sync_interval:
            fields!.sync_mode === "full"
              ? Math.max(fields!.auto_sync_interval ?? 60, 60)
              : fields!.auto_sync_interval ?? 60,
        },
        "PUT",
      ),
    );
    if (result) {
      dirty.current = false;
      s.reload();
      s.notify("设置已保存到数据库");
    } else if (dirty.current) {
      // The save failed; the edits stay in the form for a retry.
      s.notify("保存失败，请检查错误后重试", true);
    }
  }
  // Full sync below 60 minutes is not one of the offered options, and the
  // backend never honors it; show the corrected value instead of a select
  // whose label claims a value that is not in the list.
  const intervalValue =
    fields.sync_mode === "full"
      ? Math.max(fields.auto_sync_interval ?? 60, 60)
      : fields.auto_sync_interval ?? 60;
  return (
    <Page>
      <PageHeader
        title="设置"
        description="LLM 的 Base URL、模型与 API Key 在此配置；OAuth Secret 仍从后端环境配置读取。"
      >
        {dirty.current && (
          <Badge tone="warning" dot>
            有未保存的修改
          </Badge>
        )}
        <BusyButton
          label="settings"
          variant="default"
          disabled={fields.default_permission === "full" && !full}
          onClick={() => void save()}
        >
          <Save />
          保存更改
        </BusyButton>
      </PageHeader>
      <div className="page-body">
        <Card flex className="settings-card">
          <div style={{ padding: "0 16px" }}>
            <Tabs
              value={section}
              onChange={setSection}
              label="设置分组"
              items={[
                { value: "llm", label: "LLM" },
                { value: "github", label: "GitHub" },
                { value: "agent", label: "Agent 默认值" },
                { value: "sync", label: "Issue 同步" },
                { value: "tools", label: "工具与外观" },
              ]}
            />
          </div>
          <CardBody className="settings-pane" key={section}>
            {section === "llm" && (
              <>
                <h3 className="pane-title">OpenAI 兼容接口</h3>
                <div className="form-grid">
                  <Field label="Base URL">
                    <Input
                      mono
                      aria-label="Base URL"
                      value={fields.llm_base_url}
                      onChange={(e) => field({ llm_base_url: e.target.value })}
                    />
                  </Field>
                  <Field label="模型">
                    <Input
                      mono
                      aria-label="模型"
                      value={fields.llm_model}
                      onChange={(e) => field({ llm_model: e.target.value })}
                    />
                  </Field>
                  <Field label="API Key">
                    <Input
                      mono
                      type="password"
                      autoComplete="off"
                      aria-label="API Key"
                      placeholder={
                        fields.llm_configured
                          ? "已配置，留空则保持不变"
                          : "填入 API Key"
                      }
                      value={fields.llm_api_key ?? ""}
                      onChange={(e) => field({ llm_api_key: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="actions wrap">
                  <span className="small">API Key</span>
                  <Badge tone={fields.llm_configured ? "success" : "warning"} dot>
                    {fields.llm_configured ? "已配置" : "未配置"}
                  </Badge>
                  <span className="spacer" />
                  {latency !== null && (
                    <Badge tone="success">
                      <Check size={12} />
                      连接正常 · {latency}ms
                    </Badge>
                  )}
                  <BusyButton
                    label="test"
                    onClick={() =>
                      void s.perform("test", async () => {
                        const result = await api<{ latency_ms: number }>(
                          "/settings/test",
                          {},
                        );
                        setLatency(result.latency_ms);
                      })
                    }
                  >
                    <Zap />
                    测试连接
                  </BusyButton>
                </div>
                <p className="muted small">先保存 URL、模型与 API Key，再测试连接。API Key 加密保存在后端数据库，不会再显示出来。</p>
                <h3 className="pane-title">思考强度</h3>
                <div className="form-grid">
                  {effortParts.map(([part, title]) => (
                    <Field key={part} label={title}>
                      <Select
                        aria-label={title + "思考强度"}
                        value={fields.reasoning_effort?.[part] ?? ""}
                        onChange={(e) => {
                          const { [part]: _, ...rest } =
                            fields.reasoning_effort ?? {};
                          field({
                            reasoning_effort: e.target.value
                              ? { ...rest, [part]: e.target.value }
                              : rest,
                          });
                        }}
                      >
                        <option value="">默认（不指定）</option>
                        {efforts.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
                <p className="muted small">
                  以 reasoning_effort 参数发给模型，每个部分单独生效；选“默认”则不发送，由模型自行决定。
                  强度越高，思考越久、消耗的 token 越多；AI 复核等需要输出 JSON 的部分，思考也占输出额度。
                </p>
              </>
            )}
            {section === "github" && (
              <>
                <h3 className="pane-title">GitHub 连接</h3>
                <div className="kv-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  <div>
                    <span>登录状态</span>
                    <b>
                      {s.session?.user ? "已登录：" + s.session.user.login : "尚未登录"}
                    </b>
                  </div>
                  <div>
                    <span>OAuth</span>
                    <b>{s.session?.oauth_configured ? "已配置" : "未配置"}</b>
                  </div>
                  <div>
                    <span>示例仓库</span>
                    <b className="mono">{s.session?.demo_repo}</b>
                  </div>
                </div>
                <div className="actions">
                  {s.session?.user ? (
                    <BusyButton
                      label="logout"
                      onClick={() =>
                        void s.perform("logout", async () => {
                          await api("/auth/logout", {});
                          s.reload();
                        })
                      }
                    >
                      <LogOut />
                      退出登录
                    </BusyButton>
                  ) : (
                    <a
                      className={buttonVariants({ variant: "default" })}
                      href="/api/auth/github/login"
                    >
                      <LogIn />
                      使用 GitHub 登录
                    </a>
                  )}
                </div>
                {!s.session?.oauth_configured && (
                  <Alert tone="warning" title="OAuth 未配置">
                    在 backend/.env 中配置 GitHub OAuth App 后才能登录。
                  </Alert>
                )}
              </>
            )}
            {section === "agent" && (
              <>
                <h3 className="pane-title">Agent 默认值</h3>
                <div className="form-grid">
                  <Field label="工作区目录">
                    <Input
                      mono
                      aria-label="工作区目录"
                      value={fields.workspace_dir}
                      onChange={(e) => field({ workspace_dir: e.target.value })}
                    />
                  </Field>
                  <Field label="默认权限">
                    <Select
                      aria-label="默认权限"
                      value={fields.default_permission}
                      onChange={(e) => {
                        field({ default_permission: e.target.value });
                        setFull(false);
                      }}
                    >
                      {presets.map(([value, title]) => (
                        <option key={value} value={value}>
                          {title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {fields.default_permission === "full" && (
                  <Alert tone="warning">
                    <CheckRow
                      control={
                        <Checkbox
                          checked={full}
                          onChange={(e) => setFull(e.target.checked)}
                        />
                      }
                    >
                      我确认完全权限不限路径
                    </CheckRow>
                  </Alert>
                )}
                <div className="form-grid">
                  {(
                    [
                      [
                        "bash_allow",
                        "Bash 白名单（正则，每行一条，命中则跳过内置安全检查）",
                      ],
                      [
                        "bash_deny",
                        "Bash 黑名单（正则，每行一条，命中则禁止执行）",
                      ],
                    ] as const
                  ).map(([key, title]) => (
                    <Field key={key} label={title}>
                      <Textarea
                        mono
                        aria-label={title}
                        rows={4}
                        value={(fields[key] ?? []).join("\n")}
                        onChange={(e) =>
                          field({
                            [key]: e.target.value
                              .split("\n")
                              .filter((l) => l.trim()),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <p className="muted small">
                  最大步数 {fields.max_steps} · 命令超时 {fields.command_timeout}s
                  · Token 预算 {fields.max_tokens}。运行限制在 backend/.env
                  中配置；每次运行前可降低预算。
                </p>
              </>
            )}
            {section === "sync" && (
              <>
                <h3 className="pane-title">Issue 同步</h3>
                <div className="form-grid">
                  <Field label="同步方式">
                    <Select
                      aria-label="同步方式"
                      value={fields.sync_mode ?? "incremental"}
                      onChange={(e) => {
                        const mode = e.target.value as "incremental" | "full";
                        field({
                          sync_mode: mode,
                          auto_sync_interval:
                            mode === "full"
                              ? Math.max(fields.auto_sync_interval ?? 60, 60)
                              : fields.auto_sync_interval,
                        });
                      }}
                    >
                      <option value="incremental">增量（只拉有更新的 Issue）</option>
                      <option value="full">
                        全量（重新拉取全部，能发现已删除的）
                      </option>
                    </Select>
                  </Field>
                  <Field label="自动同步间隔">
                    <Select
                      aria-label="自动同步间隔"
                      value={intervalValue}
                      onChange={(e) =>
                        field({ auto_sync_interval: Number(e.target.value) })
                      }
                    >
                      {[5, 15, 30, 60, 180, 360, 720, 1440]
                        .filter((m) => fields.sync_mode !== "full" || m >= 60)
                        .map((m) => (
                          <option key={m} value={m}>
                            {m >= 60 ? m / 60 + " 小时" : m + " 分钟"}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>
                {fields.sync_mode === "full" &&
                  (fields.auto_sync_interval ?? 60) < 60 && (
                    <p className="muted small">
                      全量自动同步间隔不得小于 60 分钟，已按 60 分钟修正，保存后生效。
                    </p>
                  )}
                <CheckRow
                  control={
                    <Switch
                      aria-label="启用自动同步"
                      checked={fields.auto_sync_enabled ?? false}
                      onChange={(e) =>
                        field({ auto_sync_enabled: e.target.checked })
                      }
                    />
                  }
                >
                  启用自动同步（GitHub 仓库）
                </CheckRow>
                <p className="muted small">
                  概览页的“同步”按钮和自动同步都使用这里的同步方式。全量会重新请求所有
                  Issue 与评论，自动全量的间隔不少于 1 小时。自动同步使用最近一次同步该仓库的
                  GitHub 登录身份，退出登录后会暂停；示例仓库使用服务端配置的 token。
                </p>
              </>
            )}
            {section === "tools" && (
              <>
                <h3 className="pane-title">本机工具</h3>
                <div className="tool-grid">
                  {Object.entries(fields.tools).map(([name, installed]) => (
                    <div className="tool-chip" key={name}>
                      <strong>{name}</strong>
                      <Badge tone={installed ? "success" : "warning"} dot>
                        {installed ? "可用" : "未安装"}
                      </Badge>
                    </div>
                  ))}
                </div>
                <p className="small">
                  数据库：<span className="mono">{fields.database}</span>
                </p>
                <h3 className="pane-title">外观</h3>
                <Segmented
                  label="主题"
                  value={s.theme}
                  onChange={(t) => s.setTheme(t)}
                  items={[
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                  ]}
                />
                <div className="actions">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                    onClick={() =>
                      s.setTheme(
                        matchMedia("(prefers-color-scheme: dark)").matches
                          ? "dark"
                          : "light",
                      )
                    }
                  >
                    跟随系统
                  </button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
