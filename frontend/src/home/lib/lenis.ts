import Lenis from "lenis";
import { useEffect } from "react";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./gsap";

export const lenisRef: { current: Lenis | null } = { current: null };

export function scrollToTop() {
  if (lenisRef.current) lenisRef.current.scrollTo(0, { duration: 2.2 });
  else window.scrollTo({ top: 0 });
}

// 首页使用整页滚动：应用壳层给 body 设了 overflow:hidden，挂载期间由 .home-scroll 解除。
export function useSmoothScroll(locked: boolean) {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("home-scroll");
    // 每次进入都从开场播起：清掉 ScrollTrigger 记住的上次位置，并关闭浏览器的滚动恢复。
    // 离开后不改回 auto——工作台页面不滚动 window。
    ScrollTrigger.clearScrollMemory("manual");
    window.scrollTo(0, 0);
    // 字体晚到会改变排版高度，届时重新计算所有滚动触发点
    document.fonts.ready.then(() => ScrollTrigger.refresh());
    const restore = () => html.classList.remove("home-scroll");
    if (prefersReducedMotion()) return restore;
    const lenis = new Lenis({ autoRaf: false, anchors: true, lerp: 0.085 });
    lenisRef.current = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisRef.current = null;
      restore();
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("home-locked", locked);
    if (locked) lenisRef.current?.stop();
    else lenisRef.current?.start();
  }, [locked]);
}
