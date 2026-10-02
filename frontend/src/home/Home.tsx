import { useCallback, useState } from "react";
import "lenis/dist/lenis.css";
import "./home.css";
import { useStore } from "../lib/store";
import AgentRun from "./components/AgentRun";
import Bento from "./components/Bento";
import Cursor from "./components/Cursor";
import DitherField from "./components/DitherField";
import Graph from "./components/Graph";
import Hero from "./components/Hero";
import Loader from "./components/Loader";
import Manifesto from "./components/Manifesto";
import Conveyor from "./components/Conveyor";
import Nav from "./components/Nav";
import Outro from "./components/Outro";
import Pipeline from "./components/Pipeline";
import Stats from "./components/Stats";
import { prefersReducedMotion } from "./lib/gsap";
import { useSmoothScroll } from "./lib/lenis";

// 首页。内容全部来自 ./data 的虚拟数据，不请求后端。
export default function Home() {
  const s = useStore();
  // 减少动态效果时跳过开场；否则开场在幕布升起时把 ready 置为 true，自己随后卸载
  const [skipIntro] = useState(prefersReducedMotion);
  const [ready, setReady] = useState(skipIntro);
  const onLoaded = useCallback(() => setReady(true), []);
  useSmoothScroll(!ready);

  return (
    <div className="ow home" data-theme={s.theme}>
      {!skipIntro && <Loader onDone={onLoaded} />}
      <Cursor />
      <div className="grain" aria-hidden="true" />
      <DitherField theme={s.theme} ready={ready} />
      <Nav ready={ready} />
      <main>
        <Hero ready={ready} />
        <Conveyor />
        <Manifesto />
        <Stats />
        <Pipeline />
        <Graph theme={s.theme} />
        <AgentRun />
        <Bento />
        <Outro />
      </main>
    </div>
  );
}
