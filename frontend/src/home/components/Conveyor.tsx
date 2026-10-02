import { useEffect, useRef } from "react";
import { beltGates, beltRows, beltStates, type BeltItem } from "../data";
import { gsap, prefersReducedMotion, ScrollTrigger } from "../lib/gsap";

// 流水线传送带：工作项从左往右移动，每穿过一道关卡就当场多出一项结果——
// 扫描出级别、排进任务、生成 diff、测试通过，最后合并成 PR。滚动越快走得越快。

function Card({ item }: { item: BeltItem }) {
  return (
    <article className="cv-card" data-stage="0">
      <div className="cv-top">
        <span className="cv-src">{item.src}</span>
        <span className="cv-state">{beltStates[0]}</span>
      </div>
      <p className="cv-title">{item.title}</p>
      <div className="cv-chips">
        <span data-at="1" className={"cv-chip lv-" + item.level}>
          {item.sev}
        </span>
        <span data-at="2" className={"cv-chip own-" + item.owner}>
          {item.task}
        </span>
        <span data-at="3" className="cv-chip cv-diff">
          <b>+{item.add}</b> <i>−{item.del}</i>
        </span>
        <span data-at="4" className="cv-chip cv-ok">
          ✓ {item.tests} passed
        </span>
      </div>
      <div data-at="5" className="cv-pr">
        PR #{item.pr} · merged
      </div>
    </article>
  );
}

export default function Conveyor() {
  const root = useRef<HTMLElement>(null);
  const counter = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current!;
    const stage = section.querySelector<HTMLElement>(".cv-stage")!;
    const gates = [...section.querySelectorAll<HTMLElement>(".cv-gate")];
    const cards = [...section.querySelectorAll<HTMLElement>(".cv-row")].flatMap((row, r) =>
      [...row.querySelectorAll<HTMLElement>(".cv-card")].map((el, idx) => ({
        el,
        row: r,
        idx,
        state: el.querySelector<HTMLElement>(".cv-state")!,
        fields: [...el.querySelectorAll<HTMLElement>("[data-at]")],
        stage: -1,
      })),
    );
    let merged = 128;
    let width = 0;
    let cardW = 0;
    let loop = 0;
    let perRow = 5;
    const hits = beltGates.map(() => 0);

    const measure = () => {
      width = stage.clientWidth;
      cardW = cards[0].el.offsetWidth;
      loop = width + cardW + 40;
      // 窄屏放不下五张就少放几张，避免卡片互相压住
      perRow = Math.max(2, Math.min(5, Math.floor(loop / (cardW + 56))));
      cards.forEach((c) => (c.el.style.display = c.idx < perRow ? "" : "none"));
    };

    let distance = 0;
    const place = () => {
      const now = performance.now();
      for (const c of cards) {
        if (c.idx >= perRow) continue;
        const spacing = loop / perRow;
        const travelled = distance * (c.row ? 0.86 : 1) + c.idx * spacing + (c.row ? spacing / 2 : 0);
        const x = (travelled % loop) - cardW - 20;
        c.el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
        const center = x + cardW / 2;
        let s = 0;
        for (let g = 0; g < beltGates.length; g++) if (center > (width * (g + 1)) / 6) s++;
        if (s === c.stage) continue;
        // 向前跨过关卡才算一次“通过”；从右侧绕回左侧只是重置
        if (c.stage >= 0 && s === c.stage + 1) {
          hits[s - 1] = now;
          if (s === 5 && counter.current) counter.current.textContent = String(++merged);
        }
        c.stage = s;
        c.el.dataset.stage = String(s);
        c.state.textContent = beltStates[s];
        for (const f of c.fields) f.classList.toggle("on", Number(f.dataset.at) <= s);
      }
      gates.forEach((g, i) => g.classList.toggle("hit", now - hits[i] < 420));
    };

    measure();
    distance = loop * 0.37;
    place();
    const ro = new ResizeObserver(() => {
      measure();
      place();
    });
    ro.observe(stage);
    if (prefersReducedMotion()) return () => ro.disconnect();

    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(section);

    let boost = 1;
    let target = 1;
    const st = ScrollTrigger.create({
      trigger: section,
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => {
        target = Math.max(target, 1 + Math.min(6, Math.abs(self.getVelocity()) / 450));
      },
    });
    const tick = (_time: number, dt: number) => {
      if (!visible) return;
      target += (1 - target) * 0.04;
      boost += (target - boost) * 0.1;
      distance += (64 * boost * Math.min(dt, 50)) / 1000;
      place();
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      st.kill();
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return (
    <section ref={root} className="conveyor" aria-label="工作项流水线示意">
      <div className="cv-head">
        <span className="cv-live">
          <i />
          流水线 · 示意数据
        </span>
        <span className="cv-headline">每个问题，都走同一条路。</span>
        <span className="cv-count">
          已合并 <b ref={counter}>128</b>
        </span>
      </div>
      <div className="cv-stage">
        {beltGates.map((g, i) => (
          <div key={g} className="cv-gate" style={{ left: `${((i + 1) / 6) * 100}%` }} aria-hidden="true">
            <span>
              0{i + 1} {g}
            </span>
            <i />
          </div>
        ))}
        {beltRows.map((row, r) => (
          <div key={r} className="cv-row">
            {row.map((item) => (
              <Card key={item.pr} item={item} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
