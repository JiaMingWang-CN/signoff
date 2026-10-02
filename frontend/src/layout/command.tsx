import {
  CornerDownLeft,
  GitBranch,
  Moon,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../lib/store";
import { navItems } from "./nav";

type Item = {
  group: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  run: () => void;
};

// Ctrl K palette: jump to a page, switch repository, toggle theme, or search.
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const items = useMemo(() => {
    const q = query.trim();
    const all: Item[] = [
      ...navItems.map((n) => ({
        group: "页面",
        icon: n.icon,
        label: n.label,
        hint: n.path,
        run: () => navigate(n.path),
      })),
      ...s.repos.map((r) => ({
        group: "仓库",
        icon: GitBranch,
        label: "切换到 " + r.name,
        run: () => {
          s.select(r.id);
          navigate("/overview");
        },
      })),
      {
        group: "操作",
        icon: s.theme === "dark" ? Sun : Moon,
        label: s.theme === "dark" ? "切换为浅色主题" : "切换为深色主题",
        run: () => s.setTheme(s.theme === "dark" ? "light" : "dark"),
      },
    ];
    const hit = all.filter((i) =>
      (i.label + (i.hint || "")).toLowerCase().includes(q.toLowerCase()),
    );
    return q
      ? [
          {
            group: "检索",
            icon: Search,
            label: "在代码与 Issue 中检索：" + q,
            run: () => navigate("/search?q=" + encodeURIComponent(q)),
          },
          ...hit,
        ]
      : hit;
  }, [query, s.repos, s.theme]);
  const current = Math.min(index, Math.max(0, items.length - 1));
  function choose(i: number) {
    const item = items[i];
    if (!item) return;
    onClose();
    item.run();
  }
  let group = "";
  return (
    <dialog
      ref={ref}
      className="dlg top"
      aria-label="命令面板"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        const box = ref.current!.getBoundingClientRect();
        if (
          e.target === ref.current &&
          (e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom)
        )
          onClose();
      }}
    >
      <div className="cmd-input">
        <Search style={{ color: "var(--muted-foreground)" }} />
        <input
          autoFocus
          aria-label="命令面板输入"
          placeholder="搜索页面、仓库，或直接输入检索内容…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(Math.min(current + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(Math.max(current - 1, 0));
            } else if (e.key === "Enter") choose(current);
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="cmd-list" role="listbox">
        {items.map((item, i) => {
          const header = item.group !== group ? (group = item.group) : "";
          const Icon = item.icon;
          return (
            <div key={item.group + item.label}>
              {header && <div className="grp">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <Icon />
                <span className="ellipsis">{item.label}</span>
                {item.hint && <span className="r mono">{item.hint}</span>}
              </button>
            </div>
          );
        })}
        {!items.length && <div className="empty">没有结果</div>}
      </div>
      <div className="cmd-foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> 选择
        </span>
        <span>
          <CornerDownLeft size={12} style={{ verticalAlign: "-2px" }} /> 打开
        </span>
      </div>
    </dialog>
  );
}
