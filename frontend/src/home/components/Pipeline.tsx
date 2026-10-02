import { useRef, useState } from "react";
import { pipeline } from "../data";
import { gsap, ScrollTrigger, useGSAP } from "../lib/gsap";
import { Eyebrow } from "./fx";
import { vignettes } from "./Vignettes";

// 六步流程：桌面端钉住整屏横向滚动，窄屏退化为纵向堆叠。
export default function Pipeline() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(-1);

  useGSAP(
    () => {
      const panels = gsap.utils.toArray<HTMLElement>(".pl-panel", root.current);
      const mm = gsap.matchMedia();

      mm.add("(min-width: 900px)", () => {
        const track = root.current!.querySelector<HTMLElement>(".pl-track")!;
        const distance = () => track.scrollWidth - window.innerWidth;
        const scroller = gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: ".pl-pin",
            start: "top top",
            end: () => "+=" + distance(),
            pin: true,
            scrub: 1,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });
        gsap.to(".pl-progress i", {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: ".pl-pin",
            start: "top top",
            end: () => "+=" + distance(),
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
        panels.forEach((p, i) => {
          ScrollTrigger.create({
            trigger: p,
            containerAnimation: scroller,
            start: "left 45%",
            end: "right 45%",
            onToggle: (self) => {
              p.classList.toggle("is-active", self.isActive);
              if (self.isActive) setActive(i);
            },
          });
          // 大号序号做视差
          gsap.fromTo(
            p.querySelector(".pl-no"),
            { xPercent: 40 },
            {
              xPercent: -40,
              ease: "none",
              scrollTrigger: {
                trigger: p,
                containerAnimation: scroller,
                start: "left right",
                end: "right left",
                scrub: true,
              },
            },
          );
        });
        gsap.from(".pl-intro-title .w", {
          yPercent: 110,
          duration: 1.2,
          ease: "expo.out",
          stagger: 0.08,
          scrollTrigger: { trigger: ".pl-pin", start: "top 70%" },
        });
      });

      mm.add("(max-width: 899px)", () => {
        panels.forEach((p, i) =>
          ScrollTrigger.create({
            trigger: p,
            start: "top 65%",
            end: "bottom 35%",
            onToggle: (self) => {
              p.classList.toggle("is-active", self.isActive);
              if (self.isActive) setActive(i);
            },
          }),
        );
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="pipeline" id="pipeline">
      <div className="pl-pin">
        <div className="pl-track">
          <div className="pl-intro">
            <Eyebrow no="02">流程</Eyebrow>
            <h2 className="pl-intro-title">
              <span className="mask">
                <span className="w">六个步骤，</span>
              </span>
              <span className="mask">
                <span className="w">
                  <i className="serif">one</i> 条链路
                </span>
              </span>
            </h2>
            <p>
              从 clone 到 PR，每一步都是真实执行：真实的索引、真实的扫描、真实的 diff 与测试输出。横向滚动看完整条流水线
              <span aria-hidden="true"> →</span>
            </p>
          </div>
          {pipeline.map((step) => {
            const V = vignettes[step.key];
            return (
              <article key={step.key} className={"pl-panel pl-" + step.key}>
                <span className="pl-no" aria-hidden="true">
                  {step.no}
                </span>
                <div className="pl-copy">
                  <span className="pl-en">
                    {step.no} — {step.en}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
                <div className="pl-stage">
                  <V />
                </div>
              </article>
            );
          })}
        </div>
        <div className="pl-progress" aria-hidden="true">
          <div className="pl-steps">
            {pipeline.map((s, i) => (
              <span key={s.key} className={i === active ? "is-on" : i < active ? "is-done" : ""}>
                {s.no} {s.title}
              </span>
            ))}
          </div>
          <i />
        </div>
      </div>
    </section>
  );
}
