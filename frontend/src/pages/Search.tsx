import {
  ExternalLink,
  FileCode2,
  Search as SearchIcon,
  SearchX,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type Issue, type Repo } from "../api";
import { useFitPage } from "../lib/fit";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  BusyButton,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Code,
  Dialog,
  Empty,
  Input,
  Markdown,
  Page,
  PageHeader,
  Pager,
  ScrollPreview,
  Select,
  Textarea,
} from "../components";

type Answer = {
  answer: string;
  tokens: number;
  steps: {
    tool: string;
    args: Record<string, unknown>;
    chars: number;
    error: boolean;
  }[];
  sources: (
    | { type: "issue"; number: number; title: string; url: string }
    | { type: "code"; file: string; line: number }
  )[];
};
const toolText: Record<string, string> = {
  search_code: "检索代码",
  find_symbol: "查符号",
  search_issues: "检索 Issue",
  get_issue: "读取 Issue",
  read_file: "读取文件",
  list_files: "列出文件",
};
type SearchDialog =
  | { kind: "result" }
  | { kind: "answer" }
  | { kind: "issue"; issue: Issue };

// codegraph answers an empty search with a one-line English notice, not an
// error. A substantive answer cites code or lists rows, so the notice is
// recognizable: short, flat text that says nothing was found.
const isMiss = (text: string) => {
  const t = text.trim();
  return (
    t.length < 200 &&
    !t.includes("\n") &&
    !/[`*#\[\]]/.test(t) &&
    /no relevant|not found|no results?|no callers|no callees|nothing found|没有|未找到|无结果/i.test(t)
  );
};
const missHint: Record<string, string> = {
  explore: "试试换成代码里实际出现的函数名、类名或文件名，或用更短的关键词。",
  query: "符号检索要求名称接近完整。不确定名称时，改用“探索”模式用自然语言描述。",
  callers: "调用关系需要先给出准确的函数名；可先用“符号”模式确认名称。",
  callees: "调用关系需要先给出准确的函数名；可先用“符号”模式确认名称。",
  impact: "影响面需要先给出准确的函数名；可先用“符号”模式确认名称。",
};

const modes = [
  ["explore", "探索"],
  ["query", "符号"],
  ["callers", "调用方"],
  ["callees", "被调用方"],
  ["impact", "影响面"],
];

export default function Search() {
  const s = useStore();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [kind, setKind] = useState("code");
  const [mode, setMode] = useState("explore");
  const [state, setState] = useState("all");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<{
    text?: string;
    issues?: Repo["issues"];
    mode?: string;
  } | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [dialog, setDialog] = useState<SearchDialog | null>(null);
  const [searched, setSearched] = useState({ q: "", kind: "code", mode: "explore" });
  const issues = result?.issues || [];
  const list = useFitPage(issues, 62);

  async function search(q = query, k = kind, m = mode) {
    const data = await s.perform("search", () =>
      api<{ text?: string; issues?: Repo["issues"]; mode?: string }>(
        "/repos/" +
          s.repo!.id +
          "/search?" +
          new URLSearchParams({ q, kind: k, mode: m, state, label }),
      ),
    );
    if (data) {
      setResult(data);
      setSearched({ q, kind: k, mode: m });
      list.setPage(0);
    }
  }
  useEffect(() => {
    const q = params.get("q");
    if (q) {
      setQuery(q);
      void search(q);
    }
  }, [params]);
  const close = () => setDialog(null);
  function openCode(file: string) {
    close();
    setKind("code");
    setMode("explore");
    setQuery(file);
    void search(file, "code", "explore");
  }
  const sources = answer?.sources || [];
  function sourceLink(x: Answer["sources"][number]) {
    return x.type === "issue" ? (
      <a
        key={"i" + x.number}
        href={x.url}
        target="_blank"
        rel="noreferrer"
        className="source-chip"
      >
        <ExternalLink />#{x.number} {x.title}
      </a>
    ) : (
      <button
        key={"c" + x.file}
        type="button"
        className="source-chip mono"
        onClick={() => openCode(x.file)}
      >
        <FileCode2 />
        {x.file}:{x.line}
      </button>
    );
  }
  const labels = [...new Set(s.repo!.issues.flatMap((i) => i.labels))];

  return (
    <Page>
      <PageHeader
        crumb={s.repo!.name.split("/").at(-1)}
        title="代码与 Issue 检索"
        description="源码、调用关系和问题上下文来自当前仓库。"
      />
      <div className="page-body">
        <form
          className="search-bar card"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) void search();
          }}
        >
          <Select
            aria-label="检索对象"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setResult(null);
            }}
          >
            <option value="code">代码</option>
            <option value="issue">Issue</option>
          </Select>
          <div className="input-wrap grow">
            <SearchIcon />
            <Input
              required
              aria-label="检索内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="符号、文件或代码问题"
            />
          </div>
          {kind === "code" ? (
            <Select
              aria-label="检索模式"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {modes.map(([v, t]) => (
                <option value={v} key={v}>
                  {t}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Select
                aria-label="Issue 状态"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="all">全部状态</option>
                <option value="open">open</option>
                <option value="closed">closed</option>
              </Select>
              <Select
                aria-label="Issue 标签"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              >
                <option value="">全部标签</option>
                {labels.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </>
          )}
          <BusyButton
            label="search"
            variant="default"
            disabled={!query.trim()}
            onClick={() => void search()}
          >
            检索
          </BusyButton>
        </form>
        <div className="cols search-main fill-row">
          <Card flex>
            <CardHeader
              title={
                <>
                  检索结果
                  {issues.length > 0 && (
                    <Badge tone="muted" small>
                      {issues.length}
                    </Badge>
                  )}
                </>
              }
            />
            <div className="fit-area" ref={list.ref}>
              {result?.text && isMiss(result.text) ? (
                <Empty
                  icon={<SearchX />}
                  title={"没有找到与「" + searched.q + "」相关的代码"}
                  action={
                    searched.mode !== "explore" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMode("explore");
                          void search(searched.q, "code", "explore");
                        }}
                      >
                        改用“探索”模式再搜一次
                      </Button>
                    ) : undefined
                  }
                >
                  {missHint[searched.mode] || missHint.explore}
                </Empty>
              ) : result?.text ? (
                <ScrollPreview
                  watch={result.text}
                  onOpen={() => setDialog({ kind: "result" })}
                >
                  {result.mode === "explore" ? (
                    <Markdown text={result.text} />
                  ) : (
                    <pre className="mono small">{result.text}</pre>
                  )}
                </ScrollPreview>
              ) : list.visible.length ? (
                list.visible.map((i, n) => (
                  <button
                    type="button"
                    className="issue-item"
                    key={i.number}
                    style={{ animationDelay: n * 18 + "ms" }}
                    onClick={() => setDialog({ kind: "issue", issue: i })}
                  >
                    <strong className="ellipsis">
                      #{i.number} {i.title}
                    </strong>
                    <span className="issue-meta">
                      <Badge tone={i.state === "open" ? "success" : "muted"}>
                        {i.state}
                      </Badge>
                      {i.labels.map((l) => (
                        <Badge key={l}>{l}</Badge>
                      ))}
                    </span>
                  </button>
                ))
              ) : (
                <Empty
                  icon={result ? <SearchX /> : <SearchIcon />}
                  title={
                    result
                      ? "没有找到与「" + searched.q + "」匹配的 Issue"
                      : "开始检索"
                  }
                >
                  {result
                    ? "换个关键词，或放宽状态和标签筛选。"
                    : "输入问题后开始检索。"}
                </Empty>
              )}
            </div>
            {issues.length > 0 && (
              <div className="card-foot">
                <span>点击条目查看详情</span>
                <Pager
                  page={list.page}
                  size={list.size}
                  total={issues.length}
                  onChange={list.setPage}
                />
              </div>
            )}
          </Card>
          <Card flex>
            <CardHeader
              title={
                <>
                  <Sparkles style={{ color: "var(--brand)" }} />问 AI
                </>
              }
            />
            <CardBody fill>
              <Textarea
                rows={3}
                aria-label="AI 问题"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：搜索模块如何处理用户输入？Agent 会自行检索代码与 Issue 后回答。"
              />
              <div className="actions">
                <BusyButton
                  label="ask"
                  variant="default"
                  disabled={!question.trim()}
                  onClick={() =>
                    void s.perform("ask", async () => {
                      setAnswer(null);
                      setAnswer(
                        await api<Answer>("/repos/" + s.repo!.id + "/ask", {
                          prompt: question,
                        }),
                      );
                    })
                  }
                >
                  <Send />
                  发送
                </BusyButton>
              </div>
              {answer ? (
                <>
                  <ScrollPreview
                    className="answer"
                    watch={answer.answer}
                    onOpen={() => setDialog({ kind: "answer" })}
                  >
                    <Markdown text={answer.answer} />
                  </ScrollPreview>
                  <div className="sources">
                    {sources.slice(0, 4).map(sourceLink)}
                    {sources.length > 4 && (
                      <span className="muted small">+{sources.length - 4}</span>
                    )}
                    <span className="muted small">
                      调查 {answer.steps.length} 步 · {answer.tokens} tokens
                    </span>
                  </div>
                </>
              ) : (
                <div className="fit-area">
                  <Empty icon={<Sparkles />}>
                    提问后在这里显示回答，完整内容在弹窗中查看。
                  </Empty>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      {dialog?.kind === "result" && result?.text && (
        <Dialog size="wide" title="检索结果" onClose={close}>
          {result.mode === "explore" ? (
            <Markdown text={result.text} />
          ) : (
            <Code text={result.text} />
          )}
        </Dialog>
      )}
      {dialog?.kind === "issue" && (
        <Dialog
          size="wide"
          title={"#" + dialog.issue.number + " " + dialog.issue.title}
          header={
            <div className="actions wrap" style={{ marginBottom: 6 }}>
              <Badge tone={dialog.issue.state === "open" ? "success" : "muted"}>
                {dialog.issue.state}
              </Badge>
              {dialog.issue.labels.map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
            </div>
          }
          footer={
            <a
              className={buttonVariants({ variant: "outline" })}
              href={dialog.issue.html_url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />在 GitHub 打开
            </a>
          }
          onClose={close}
        >
          <Markdown text={dialog.issue.body || "（无正文）"} />
          {dialog.issue.comments_text && (
            <>
              <h3>评论</h3>
              <Markdown text={dialog.issue.comments_text} />
            </>
          )}
        </Dialog>
      )}
      {dialog?.kind === "answer" && answer && (
        <Dialog size="wide" title="回答详情" onClose={close}>
          <Markdown text={answer.answer} />
          {sources.length > 0 && (
            <>
              <h3>引用</h3>
              <div className="sources">{sources.map(sourceLink)}</div>
            </>
          )}
          <h3>
            调查过程 · {answer.steps.length} 步 · {answer.tokens} tokens
          </h3>
          {answer.steps.map((x, i) => (
            <div className="step-row" key={i}>
              <span className="mono small">
                {toolText[x.tool] || x.tool}{" "}
                {String(
                  x.args.query ??
                    x.args.symbol ??
                    x.args.path ??
                    x.args.number ??
                    "",
                )}
              </span>
              <Badge tone={x.error ? "danger" : "success"}>
                {x.error ? "失败" : x.chars + " 字符"}
              </Badge>
            </div>
          ))}
        </Dialog>
      )}
    </Page>
  );
}
