import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Link } from "react-router";
import { useStore } from "../../lib/store";
import { gsap, ScrollTrigger, useGSAP } from "../lib/gsap";
import { Magnetic, RollLink } from "./fx";

const links = [
  { href: "#pipeline", text: "流程" },
  { href: "#graph", text: "代码图谱" },
  { href: "#run", text: "运行" },
  { href: "#features", text: "能力" },
];

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="nav-clock" aria-hidden="true">
      {now.toLocaleTimeString("zh-CN", { hour12: false })}
    </span>
  );
}

export default function Nav({ ready }: { ready: boolean }) {
  const s = useStore();
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!ready) return;
      gsap.from(".nav-item", {
        yPercent: -120,
        opacity: 0,
        duration: 1,
        ease: "expo.out",
        stagger: 0.06,
        delay: 0.5,
      });
      // 向下滚动收起，向上滚动出现
      const hide = gsap
        .to(root.current, { yPercent: -110, duration: 0.45, ease: "power3.inOut", paused: true })
        .progress(0);
      ScrollTrigger.create({
        start: 120,
        end: "max",
        onUpdate: (self) => (self.direction === 1 ? hide.play() : hide.reverse()),
        onLeaveBack: () => hide.reverse(),
      });
      // 滚到橙色结尾段时，导航改用深色字、去掉渐隐底
      const accent = document.querySelector(".oc");
      if (accent)
        ScrollTrigger.create({
          trigger: accent,
          start: "top 70px",
          end: "bottom 70px",
          toggleClass: { targets: root.current!, className: "on-accent" },
        });
      gsap.to(".nav-progress", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });
    },
    { scope: root, dependencies: [ready] },
  );

  return (
    <header ref={root} className="home-bar">
      <Link to="/" className="nav-brand nav-item" aria-label="Signoff 首页">
        <span className="nav-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          Sign<em>/</em>off
        </span>
      </Link>
      <nav className="nav-links" aria-label="首页导航">
        {links.map((l, i) => (
          <span key={l.href} className="nav-item">
            <sup>0{i + 1}</sup>
            <RollLink href={l.href} text={l.text} />
          </span>
        ))}
      </nav>
      <div className="nav-right">
        <span className="nav-item">
          <Clock />
        </span>
        <button
          type="button"
          className="nav-theme nav-item"
          role="switch"
          aria-label="切换深浅色主题"
          aria-checked={s.theme === "dark"}
          title={s.theme === "dark" ? "切换至浅色主题" : "切换至深色主题"}
          onClick={() => s.setTheme(s.theme === "light" ? "dark" : "light")}
        >
          <span className={s.theme === "light" ? "is-active" : ""} aria-hidden="true">
            <Sun size={18} strokeWidth={1.6} />
          </span>
          <span className={s.theme === "dark" ? "is-active" : ""} aria-hidden="true">
            <Moon size={18} strokeWidth={1.6} />
          </span>
        </button>
        <Magnetic className="nav-item">
          <Link to="/repos" className="nav-cta">
            <span className="nav-cta-dot" aria-hidden="true" />
            进入工作台
          </Link>
        </Magnetic>
      </div>
      <i className="nav-progress" aria-hidden="true" />
    </header>
  );
}
