import { useEffect, useMemo, useRef, useState } from "react";
import { graphEdges, graphNodes, repo, type GraphKind } from "../data";
import { gsap, useGSAP } from "../lib/gsap";
import { Eyebrow } from "./fx";

type Node = {
  id: string;
  kind: GraphKind;
  file: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
};

const callersOf = (id: string) => graphEdges.filter(([, b]) => b === id).map(([a]) => a);
const calleesOf = (id: string) => graphEdges.filter(([a]) => a === id).map(([, b]) => b);

// 影响面：沿“被谁调用”反向可达的全部符号
function impactOf(id: string) {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of callersOf(cur))
      if (!seen.has(c) && c !== id) {
        seen.add(c);
        queue.push(c);
      }
  }
  return [...seen];
}

const kindLabel: Record<GraphKind, string> = {
  file: "文件",
  class: "类",
  fn: "函数",
  test: "测试",
};

export default function Graph({ theme }: { theme: string }) {
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState("search_notes");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [hover, setHover] = useState<string | null>(null);

  const info = useMemo(
    () => ({
      node: graphNodes.find((n) => n.id === selected)!,
      callers: callersOf(selected),
      callees: calleesOf(selected),
      impact: impactOf(selected),
    }),
    [selected],
  );

  useGSAP(
    () => {
      gsap.from(".gr-title .w", {
        yPercent: 110,
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.08,
        scrollTrigger: { trigger: root.current, start: "top 70%" },
      });
      gsap.from(".gr-canvas-wrap", {
        clipPath: "inset(8% 8% 8% 8% round 28px)",
        duration: 1.6,
        ease: "expo.out",
        scrollTrigger: { trigger: ".gr-canvas-wrap", start: "top 80%" },
      });
    },
    { scope: root },
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const cs = getComputedStyle(canvas);
    const col = {
      fg: cs.getPropertyValue("--h-fg").trim(),
      dim: cs.getPropertyValue("--h-dim").trim(),
      line: cs.getPropertyValue("--h-line").trim(),
      accent: cs.getPropertyValue("--h-accent").trim(),
      agent: cs.getPropertyValue("--h-agent").trim(),
      bg: cs.getPropertyValue("--h-bg-2").trim(),
    };

    let W = 0,
      H = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const nodes: Node[] = graphNodes.map((n, i) => {
      const a = (i / graphNodes.length) * Math.PI * 2;
      return {
        ...n,
        x: W / 2 + Math.cos(a) * W * 0.3,
        y: H / 2 + Math.sin(a) * H * 0.3,
        vx: 0,
        vy: 0,
        fixed: false,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graphEdges.map(([a, b]) => [byId.get(a)!, byId.get(b)!] as const);
    const degree = new Map<string, number>();
    graphEdges.forEach(([a, b]) => {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    });
    const radius = (n: Node) => 3 + Math.sqrt(degree.get(n.id) ?? 1) * 2.2;

    const pointer = { x: -999, y: -999, inside: false };
    let drag: Node | null = null;
    let hovered: Node | null = null;
    let downAt = { x: 0, y: 0 };

    const pick = (x: number, y: number) => {
      let best: Node | null = null;
      let bd = 18 * 18;
      for (const n of nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    };
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.inside = true;
      if (drag) {
        drag.x = p.x;
        drag.y = p.y;
        drag.vx = drag.vy = 0;
        return;
      }
      const h = pick(p.x, p.y);
      if (h !== hovered) {
        hovered = h;
        setHover(h?.id ?? null);
      }
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      downAt = p;
      const h = pick(p.x, p.y);
      if (h) {
        drag = h;
        h.fixed = true;
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (drag) {
        if (Math.hypot(p.x - downAt.x, p.y - downAt.y) < 4) setSelected(drag.id);
        drag.fixed = false;
        drag = null;
      }
    };
    const onLeave = () => {
      pointer.inside = false;
      hovered = null;
      setHover(null);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);

    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    let t = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (!visible) return;
      t += 1;
      const rest = Math.min(W, H) * 0.13;
      // 斥力
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          let dx = a.x - b.x,
            dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 1400 / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
      // 弹簧
      for (const [a, b] of edges) {
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (d - rest) * 0.004;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        // 向心 + 指针轻微排斥
        n.vx += (W / 2 - n.x) * 0.0009;
        n.vy += (H / 2 - n.y) * 0.0012;
        if (pointer.inside && !drag) {
          const dx = n.x - pointer.x,
            dy = n.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 90 * 90 && d2 > 400) {
            n.vx += (dx / d2) * 30;
            n.vy += (dy / d2) * 30;
          }
        }
        if (n.fixed) continue;
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(24, Math.min(W - 24, n.x));
        n.y = Math.max(24, Math.min(H - 24, n.y));
      }

      // 绘制
      const focus = hovered ?? byId.get(selectedRef.current)!;
      const near = new Set<string>([focus.id]);
      for (const [a, b] of edges) {
        if (a === focus) near.add(b.id);
        if (b === focus) near.add(a.id);
      }
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        const hot = a === focus || b === focus;
        ctx.strokeStyle = hot ? (a === focus ? col.agent : col.accent) : col.line;
        ctx.globalAlpha = hot ? 0.95 : 0.7;
        ctx.lineWidth = hot ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (hot) {
          // 沿边流动的光点：从调用方流向被调用方
          const k = ((t * 0.012 + (a.x + b.y) * 0.001) % 1 + 1) % 1;
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = "500 11px 'JetBrains Mono Variable', ui-monospace, monospace";
      ctx.textBaseline = "middle";
      for (const n of nodes) {
        const r = radius(n);
        const isFocus = n === focus;
        const isNear = near.has(n.id);
        ctx.globalAlpha = isNear ? 1 : 0.55;
        ctx.fillStyle = isFocus ? col.accent : n.kind === "test" ? col.bg : col.fg;
        ctx.strokeStyle = isFocus ? col.accent : col.fg;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        if (n.kind === "file") ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
        else if (n.kind === "class") {
          ctx.moveTo(n.x, n.y - r * 1.3);
          ctx.lineTo(n.x + r * 1.3, n.y);
          ctx.lineTo(n.x, n.y + r * 1.3);
          ctx.lineTo(n.x - r * 1.3, n.y);
          ctx.closePath();
        } else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.kind === "test") ctx.stroke();
        if (isFocus) {
          ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 0.08);
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 8 + 3 * Math.sin(t * 0.08), 0, Math.PI * 2);
          ctx.stroke();
        }
        if (isNear || n.kind === "file") {
          ctx.globalAlpha = isNear ? 1 : 0.6;
          ctx.fillStyle = isFocus ? col.accent : col.fg;
          ctx.fillText(n.id, n.x + r + 6, n.y);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [theme]);

  const pickBtn = (id: string) => (
    <button key={id} type="button" className="gr-sym" onClick={() => setSelected(id)}>
      {id}
    </button>
  );

  return (
    <section ref={root} className="graph" id="graph">
      <div className="gr-head">
        <Eyebrow no="03">代码图谱</Eyebrow>
        <h2 className="gr-title">
          <span className="mask">
            <span className="w">整个仓库，</span>
          </span>
          <span className="mask">
            <span className="w">
              是一张<i className="serif">graph.</i>
            </span>
          </span>
        </h2>
        <p className="gr-lede">
          以下为示意：codegraph 把一个 {repo.files} 个文件的仓库解析成符号与调用边。拖动节点、点选符号——Agent 修改代码前，看的就是这张图里的影响面。
        </p>
      </div>
      <div className="gr-body">
        <div className="gr-canvas-wrap">
          <canvas ref={canvasRef} className="gr-canvas" data-cursor="拖拽" aria-label="示例仓库的代码调用图，可拖拽节点" />
          <div className="gr-legend" aria-hidden="true">
            <span>
              <i className="lg-file" />
              文件
            </span>
            <span>
              <i className="lg-class" />类
            </span>
            <span>
              <i className="lg-fn" />
              函数
            </span>
            <span>
              <i className="lg-test" />
              测试
            </span>
            <span className="lg-sep">
              <i className="lg-out" />
              调用
            </span>
            <span>
              <i className="lg-in" />
              被调用
            </span>
          </div>
          <span className="gr-hint" aria-hidden="true">
            {hover ? `→ ${hover}` : "拖拽节点 · 点击查看影响面"}
          </span>
        </div>
        <aside className="gr-panel" aria-live="polite">
          <span className="gr-kind">
            {kindLabel[info.node.kind]} · {info.node.file}
          </span>
          <h3 key={selected} className="gr-name">
            {selected}
          </h3>
          <dl>
            <div>
              <dt>调用方 {info.callers.length}</dt>
              <dd>{info.callers.length ? info.callers.map(pickBtn) : <span className="vg-dim">—</span>}</dd>
            </div>
            <div>
              <dt>被调用 {info.callees.length}</dt>
              <dd>{info.callees.length ? info.callees.map(pickBtn) : <span className="vg-dim">—</span>}</dd>
            </div>
          </dl>
          <div className="gr-impact">
            <span className="gr-impact-n">{info.impact.length}</span>
            <span>
              个符号会受到
              <br />
              这次修改的影响
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}
