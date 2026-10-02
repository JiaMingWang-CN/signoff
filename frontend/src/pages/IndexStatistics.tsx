import { useState } from "react";
import type { Repo } from "../api";
import { Badge, Button, Card, CardHeader, Code, Dialog } from "../components";

type Stats = Repo["stats"];

const languages: Record<string, { name: string; color: string }> = {
  ".py": { name: "Python", color: "#3572a5" },
  ".ts": { name: "TypeScript", color: "#3178c6" },
  ".tsx": { name: "TypeScript", color: "#3178c6" },
  ".js": { name: "JavaScript", color: "#b89c16" },
  ".jsx": { name: "JavaScript", color: "#b89c16" },
  ".html": { name: "HTML", color: "#e34c26" },
  ".css": { name: "CSS", color: "#8554bb" },
  ".go": { name: "Go", color: "#008da3" },
  ".rs": { name: "Rust", color: "#a65d38" },
  ".json": { name: "JSON", color: "#7c8799" },
  ".md": { name: "Markdown", color: "#7585b2" },
  ".yaml": { name: "YAML", color: "#b66486" },
  ".yml": { name: "YAML", color: "#b66486" },
  ".toml": { name: "TOML", color: "#b66486" },
  ".txt": { name: "文本", color: "#80948a" },
};
const nodeNames: Record<string, string> = {
  class: "类",
  constant: "常量",
  file: "文件",
  function: "函数",
  import: "导入",
  method: "方法",
  property: "属性",
  variable: "变量",
  route: "路由",
  interface: "接口",
  type: "类型",
  type_alias: "类型别名",
  enum: "枚举",
  module: "模块",
  export: "导出",
  parameter: "参数",
};
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const format = (value: unknown) =>
  number(value)?.toLocaleString("zh-CN") ?? "—";
const compact = (value: unknown) => {
  const n = number(value);
  if (n === null) return "—";
  return n >= 10000 ? (n / 1000).toFixed(1) + "k" : n.toLocaleString("zh-CN");
};

function distribution(stats: Stats) {
  const grouped = new Map<
    string,
    { name: string; color: string; count: number }
  >();
  for (const [extension, value] of Object.entries(stats.languages || {})) {
    const count = number(value);
    if (!count) continue;
    const language = languages[extension] || {
      name: extension || "其他",
      color: "#80948a",
    };
    grouped.set(language.name, {
      ...language,
      count: (grouped.get(language.name)?.count || 0) + count,
    });
  }
  const items = [...grouped.values()].sort((a, b) => b.count - a.count);
  return { items, total: items.reduce((sum, item) => sum + item.count, 0) };
}

function indexState(stats: Stats) {
  const ready =
    stats.initialized === true &&
    (!stats.index?.state || stats.index.state === "complete");
  const needsReindex = stats.index?.reindexRecommended === true;
  return needsReindex
    ? { tone: "warning" as const, text: "建议重新索引" }
    : ready
      ? { tone: "success" as const, text: "索引就绪" }
      : { tone: "info" as const, text: "等待索引" };
}

function LanguageBar({
  items,
  total,
}: {
  items: { name: string; color: string; count: number }[];
  total: number;
}) {
  return (
    <div className="meter" aria-hidden="true">
      {items.map((item, i) => (
        <span
          key={item.name}
          style={{
            width: `${(item.count / total) * 100}%`,
            background: item.color,
            animationDelay: i * 60 + "ms",
          }}
          title={`${item.name}：${item.count} 个文件`}
        />
      ))}
    </div>
  );
}

function Details({ stats }: { stats: Stats }) {
  const { items, total } = distribution(stats);
  const nodes = Object.entries(stats.nodesByKind || {})
    .filter(([, value]) => number(value) !== null && value > 0)
    .sort((a, b) => b[1] - a[1]);
  const maximum = nodes[0]?.[1] || 1;
  return (
    <>
      <div className="kv-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {[
          ["已索引文件", stats.fileCount ?? stats.file_count],
          ["索引节点", stats.nodeCount],
          ["关系边", stats.edgeCount],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <b style={{ fontSize: 20 }}>{format(value)}</b>
          </div>
        ))}
      </div>
      <div className="index-charts">
        <div>
          <h3>
            语言分布{" "}
            <span className="small muted">
              按文件数量 · {total.toLocaleString("zh-CN")} 个文件
            </span>
          </h3>
          {total ? (
            <>
              <LanguageBar items={items} total={total} />
              <ul className="language-legend">
                {items.map((item) => (
                  <li key={item.name}>
                    <i style={{ background: item.color }} />
                    <span>{item.name}</span>
                    <span className="muted">
                      {item.count.toLocaleString("zh-CN")} 文件
                    </span>
                    <b>{((item.count / total) * 100).toFixed(1)}%</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">暂无语言统计</p>
          )}
        </div>
        <div>
          <h3>
            节点类型 <span className="small muted">按节点数量</span>
          </h3>
          {nodes.length ? (
            <ul className="node-distribution">
              {nodes.map(([kind, count]) => (
                <li key={kind}>
                  <span title={kind}>{nodeNames[kind] || kind}</span>
                  <div className="node-track" aria-hidden="true">
                    <div style={{ width: `${(count / maximum) * 100}%` }} />
                  </div>
                  <b>{count.toLocaleString("zh-CN")}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无节点类型统计</p>
          )}
        </div>
      </div>
      <p className="small muted" style={{ margin: "16px 0 8px" }}>
        {stats.lastIndexed
          ? `最近索引 ${new Date(stats.lastIndexed).toLocaleString("zh-CN")}`
          : "尚无索引时间"}
        {stats.version ? ` · CodeGraph ${stats.version}` : ""}
      </p>
      <h3>原始数据</h3>
      <Code text={JSON.stringify(stats, null, 2)} />
    </>
  );
}

// Compact index card for the overview; the full charts open in a dialog.
export default function IndexStatistics({ stats }: { stats: Stats }) {
  const [open, setOpen] = useState(false);
  const { items, total } = distribution(stats);
  const state = indexState(stats);
  const shown = items.slice(0, 3);
  const rest = items.slice(3).reduce((sum, item) => sum + item.count, 0);
  const legend = rest
    ? [...shown, { name: "其他", color: "var(--border-strong)", count: rest }]
    : shown;
  return (
    <Card aria-label="代码索引统计与语言分布">
      <CardHeader
        title={
          <>
            索引统计
            <Badge tone={state.tone} small>
              {state.text}
            </Badge>
          </>
        }
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            详情
          </Button>
        }
      />
      <div className="card-body" style={{ paddingBottom: 12 }}>
        {total ? (
          <>
            <LanguageBar items={legend} total={total} />
            <div className="legend">
              {legend.map((item) => (
                <div key={item.name}>
                  <i style={{ background: item.color }} />
                  {item.name}
                  <b>{item.count.toLocaleString("zh-CN")}</b>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">暂无语言统计</p>
        )}
      </div>
      <div className="kv">
        <div>
          <span>文件</span>
          <strong>{compact(stats.fileCount ?? stats.file_count)}</strong>
        </div>
        <div>
          <span>节点</span>
          <strong>{compact(stats.nodeCount)}</strong>
        </div>
        <div>
          <span>关系边</span>
          <strong>{compact(stats.edgeCount)}</strong>
        </div>
      </div>
      {open && (
        <Dialog
          size="wide"
          title="代码索引统计与语言分布"
          description="来自 codegraph 的索引数据"
          onClose={() => setOpen(false)}
        >
          <Details stats={stats} />
        </Dialog>
      )}
    </Card>
  );
}
