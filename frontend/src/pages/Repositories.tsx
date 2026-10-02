import { FolderGit2, FolderInput, LogIn, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, type Repo } from "../api";
import { useFitPage } from "../lib/fit";
import { useResource } from "../lib/resource";
import { useStore } from "../lib/store";
import { dateText, statusText, statusTone } from "../lib/utils";
import {
  Badge,
  BusyButton,
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Empty,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  Pager,
  SearchInput,
  Select,
  Tabs,
} from "../components";

type Remote = {
  full_name: string;
  description: string;
  language: string;
  updated_at: string;
};

export default function Repositories() {
  const s = useStore();
  const navigate = useNavigate();
  const signedIn = !!s.session?.user;
  const remote = useResource<Remote[]>(signedIn ? "/github/repos" : null);
  const [picked, setTab] = useState<"github" | "imported" | null>(null);
  // Guests have no GitHub list, so open on the workspaces they can use.
  const tab = picked ?? (signedIn ? "github" : "imported");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [language, setLanguage] = useState("");
  const [local, setLocal] = useState("");
  async function importRepo(body: unknown) {
    const result = await s.perform("import", () =>
      api<Repo>("/repos/import", body),
    );
    if (result) {
      s.select(result.id);
      s.reload();
      navigate("/overview");
    }
  }
  const login = s.session?.user?.login || "";
  const rows = (remote.data || []).filter(
    (r) =>
      (r.full_name + " " + r.description)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!language || r.language === language) &&
      (filter === "all" ||
        (filter === "imported" &&
          s.repos.some((x) => x.name === r.full_name)) ||
        (filter === "personal" && r.full_name.startsWith(login + "/")) ||
        (filter === "org" && !r.full_name.startsWith(login + "/"))),
  );
  const githubList = useFitPage(rows, 68);
  const importedList = useFitPage(s.repos, 68);
  const list = tab === "github" ? githubList : importedList;

  function open(id: string) {
    s.select(id);
    navigate("/overview");
  }

  return (
    <Page>
      <PageHeader
        title="仓库选择"
        description="导入仓库，建立代码索引并同步 Issue。"
      >
        {signedIn && (
          <Button variant="outline" onClick={remote.reload}>
            <RefreshCw />
            刷新列表
          </Button>
        )}
      </PageHeader>
      <div className="cols repos-main fill-row">
        <Card flex>
          <div style={{ padding: "0 16px" }}>
            <Tabs
              value={tab}
              onChange={setTab}
              label="仓库来源"
              items={[
                { value: "github", label: "GitHub 仓库" },
                {
                  value: "imported",
                  label: "已导入的工作区",
                  badge: (
                    <Badge tone="muted" small>
                      {s.repos.length}
                    </Badge>
                  ),
                },
              ]}
            />
          </div>
          {tab === "github" && signedIn && (
            <div className="toolbar">
              <SearchInput
                aria-label="筛选仓库"
                placeholder="按名称或描述筛选"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select
                aria-label="归属"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">全部</option>
                <option value="personal">个人</option>
                <option value="org">组织</option>
                <option value="imported">已导入</option>
              </Select>
              <Select
                aria-label="语言"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="">全部语言</option>
                {[
                  ...new Set(
                    (remote.data || []).map((r) => r.language).filter(Boolean),
                  ),
                ].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </div>
          )}
          <div className="fit-area" ref={list.ref}>
            {tab === "github" ? (
              !signedIn ? (
                <Empty
                  icon={<LogIn />}
                  title="登录后选择你的仓库"
                  action={
                    <a
                      className={buttonVariants({ size: "sm" })}
                      href="/api/auth/github/login"
                    >
                      使用 GitHub 登录
                    </a>
                  }
                >
                  访客可以使用公开示例仓库，或在右侧导入本地 Git 仓库。
                </Empty>
              ) : remote.error ? (
                <div style={{ padding: 16 }}>
                  <Notice error>{remote.error}</Notice>
                </div>
              ) : !remote.data ? (
                <Empty>正在从 GitHub 获取仓库…</Empty>
              ) : githubList.visible.length ? (
                githubList.visible.map((r, i) => {
                  const imported = s.repos.find((x) => x.name === r.full_name);
                  return (
                    <div
                      className="list-row"
                      key={r.full_name}
                      style={{ animationDelay: i * 18 + "ms" }}
                    >
                      <div>
                        <div className="t ellipsis">{r.full_name}</div>
                        <div className="d ellipsis">
                          {r.description || "暂无描述"}
                        </div>
                        <div className="m">
                          {r.language && <Badge small>{r.language}</Badge>}
                          <span>更新于 {dateText(r.updated_at)}</span>
                        </div>
                      </div>
                      {imported ? (
                        <>
                          <Badge tone={statusTone(imported.status)} dot>
                            {statusText[imported.status]}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => open(imported.id)}
                          >
                            打开
                          </Button>
                        </>
                      ) : (
                        <BusyButton
                          label="import"
                          size="sm"
                          onClick={() => void importRepo({ name: r.full_name })}
                        >
                          导入
                        </BusyButton>
                      )}
                    </div>
                  );
                })
              ) : (
                <Empty title="没有匹配的仓库">换个关键词或清除筛选条件。</Empty>
              )
            ) : importedList.visible.length ? (
              importedList.visible.map((r, i) => (
                <div
                  className="list-row"
                  key={r.id}
                  style={{ animationDelay: i * 18 + "ms" }}
                >
                  <div>
                    <div className="t ellipsis">{r.name}</div>
                    <div className="d ellipsis mono" title={r.path}>
                      {r.path}
                    </div>
                  </div>
                  <Badge tone={statusTone(r.status)} dot>
                    {statusText[r.status]}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open(r.id)}
                  >
                    打开
                  </Button>
                </div>
              ))
            ) : (
              <Empty icon={<FolderGit2 />} title="还没有导入仓库">
                从 GitHub 导入，或在右侧导入本地 Git 仓库。
              </Empty>
            )}
          </div>
          <div className="card-foot">
            <span>
              {tab === "github" ? "GitHub 仓库" : "已导入的工作区"}
            </span>
            {list.total > list.size && (
              <Pager
                page={list.page}
                size={list.size}
                total={list.total}
                onChange={list.setPage}
              />
            )}
          </div>
        </Card>
        <div className="stack">
          <Card>
            <CardHeader title="导入本地 Git 仓库" />
            <CardBody>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (local.trim()) void importRepo({ local_path: local });
                }}
              >
                <Field label="仓库绝对路径">
                  <Input
                    required
                    mono
                    aria-label="本地仓库路径"
                    value={local}
                    onChange={(e) => setLocal(e.target.value)}
                    placeholder="C:\projects\repository"
                  />
                </Field>
                <p className="muted small">
                  在工作区克隆已提交的 Git
                  版本，保留源仓库。未提交的文件不会进入克隆。
                </p>
                <BusyButton
                  label="import"
                  variant="default"
                  disabled={!local.trim()}
                  onClick={() => void importRepo({ local_path: local })}
                >
                  <FolderInput />
                  导入本地仓库
                </BusyButton>
              </form>
            </CardBody>
          </Card>
          {!signedIn && (
            <Card>
              <CardHeader title="GitHub 连接" />
              <CardBody>
                <p className="muted small" style={{ marginBottom: 12 }}>
                  访客可以使用公开示例仓库。选择个人或组织仓库需要登录。
                </p>
                <a
                  className={buttonVariants({ variant: "default" })}
                  href="/api/auth/github/login"
                >
                  <LogIn />
                  使用 GitHub 登录
                </a>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
