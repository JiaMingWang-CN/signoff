import { ArrowDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

export function Code({ text }: { text: string }) {
  return <pre className="live-code mono">{text || "暂无输出"}</pre>;
}

// Unified diff with added / removed / hunk lines tinted.
export function DiffView({ text }: { text: string }) {
  return (
    <pre className="code-block">
      {(text || "暂无变更").split("\n").map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("@@")
              ? "hunk"
              : line.startsWith("+") && !line.startsWith("+++")
                ? "add"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "del"
                  : undefined
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

// LLM answers and Issue text are Markdown. react-markdown does not render raw
// HTML, so untrusted text stays inert.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// A preview that scrolls inside its own box. While more content is below it
// shows a bouncing "scroll down" hint; clicking the hint opens the full view.
export function ScrollPreview({
  children,
  watch,
  onOpen,
  className = "",
}: {
  children: ReactNode;
  watch: string;
  onOpen: () => void;
  className?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const el = body.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update, watch]);
  return (
    <div className={cn("preview", className)}>
      <div className="preview-body" ref={body} onScroll={update}>
        {children}
      </div>
      {more && (
        <button
          type="button"
          className="preview-hint"
          aria-label="查看全部"
          onClick={onOpen}
        >
          <span>向下滑动，点击查看全部</span>
          <span className="arrow" aria-hidden="true">
            <ArrowDown size={13} />
          </span>
        </button>
      )}
    </div>
  );
}
