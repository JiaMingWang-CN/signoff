import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/gsap";

// 整页背景：低分辨率渲染的域扭曲噪声，经 8×8 Bayer 抖动量化为三色像素，
// 再按 pixelated 放大。鼠标处有透镜鼓起与辉光。
// 固定在整页背后、只有一张画布：首屏时浓烈，滚离首屏时连续过渡为更稀疏、贴着两侧的形态，
// 首屏与下面各段之间没有接缝。

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
uniform float uScroll;
uniform float uIntro;
uniform float uAmbient; // 0 = 首屏形态，1 = 下方各段形态
uniform vec3 uBg;
uniform vec3 uMid;
uniform vec3 uHi;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
#define bayer4(a) (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
#define bayer8(a) (bayer4(0.5 * (a)) * 0.25 + bayer2(a))

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y) * 1.7;
  vec2 m = vec2(uMouse.x * asp, uMouse.y) * 1.7;
  float md = length(p - m);
  p -= (p - m) * 0.45 * exp(-md * md * 2.2) * uHover;

  float t = uTime * 0.05;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.6 * q + vec2(1.7, 9.2) + 0.6 * t),
                fbm(p + 3.6 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p + 3.2 * r + vec2(0.0, uScroll));

  float hero = pow(smoothstep(0.32, 0.92, f), 1.25) * 1.5;
  hero += 0.55 * exp(-md * md * 5.0) * uHover;
  hero *= mix(0.25, 1.0, smoothstep(0.05, 0.85, uv.x + (1.0 - uv.y) * 0.25));
  float amb = pow(smoothstep(0.42, 0.95, f), 1.3) * 1.25;
  amb += 0.3 * exp(-md * md * 6.0) * uHover;
  amb *= mix(0.22, 1.0, 1.0 - smoothstep(0.06, 0.4, min(uv.x, 1.0 - uv.x)));
  float v = mix(hero, amb, uAmbient) * uIntro;

  float d = bayer8(gl_FragCoord.xy);
  float k = floor(clamp(v, 0.0, 0.999) * 2.0 + d);
  vec3 col = k < 0.5 ? uBg : (k < 1.5 ? uMid : uHi);
  gl_FragColor = vec4(col, 1.0);
}
`;

function toRgb(css: string): [number, number, number] {
  const c = document.createElement("canvas").getContext("2d")!;
  c.fillStyle = css.trim() || "#000";
  const hex = c.fillStyle as string;
  if (hex.startsWith("#")) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = hex.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}

const mix3 = (a: number[], b: number[], t: number) =>
  a.map((x, i) => x + (b[i] - x) * t) as [number, number, number];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Palette = { bg: number[]; mid: number[]; hi: number[] };

export default function DitherField({ theme, ready }: { theme: string; ready: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const palettes = useRef<{ hero: Palette; amb: Palette } | null>(null);
  const intro = useRef({ value: 0, target: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const bg = toRgb(cs.getPropertyValue("--h-bg"));
    const accent = toRgb(cs.getPropertyValue("--h-accent"));
    const fg = toRgb(cs.getPropertyValue("--h-fg"));
    const dark = theme === "dark";
    palettes.current = {
      hero: {
        bg,
        mid: mix3(bg, accent, dark ? 0.82 : 0.9),
        hi: mix3(accent, fg, dark ? 0.55 : 0.35),
      },
      amb: { bg, mid: mix3(bg, accent, dark ? 0.5 : 0.45), hi: mix3(bg, accent, 0.85) },
    };
  }, [theme]);

  useEffect(() => {
    intro.current.target = ready ? 1 : 0;
  }, [ready]);

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes"),
      uTime = u("uTime"),
      uMouse = u("uMouse"),
      uHover = u("uHover"),
      uScroll = u("uScroll"),
      uIntro = u("uIntro"),
      uAmbient = u("uAmbient"),
      uBg = u("uBg"),
      uMid = u("uMid"),
      uHi = u("uHi");

    const reduced = prefersReducedMotion();
    const pixel = window.innerWidth < 700 ? 3 : 4;
    const resize = () => {
      canvas.width = Math.max(1, Math.ceil(canvas.clientWidth / pixel));
      canvas.height = Math.max(1, Math.ceil(canvas.clientHeight / pixel));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const mouse = { x: 0.7, y: 0.5, tx: 0.7, ty: 0.5, h: 0, th: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / r.width;
      mouse.ty = 1 - (e.clientY - r.top) / r.height;
      mouse.th = mouse.ty >= 0 && mouse.ty <= 1 ? 1 : 0;
    };
    const onLeave = () => (mouse.th = 0);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const page = window.scrollY / window.innerHeight;
      const amb = smooth(0.15, 0.85, page);
      const k = 0.08;
      mouse.x += (mouse.tx - mouse.x) * k;
      mouse.y += (mouse.ty - mouse.y) * k;
      mouse.h += (mouse.th - mouse.h) * 0.05;
      const it = intro.current;
      it.value += (it.target - it.value) * (reduced ? 1 : 0.025);
      const { hero, amb: ap } = palettes.current!;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduced ? 12 : (now - start) / 1000 + 12);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uHover, mouse.h);
      // 首屏内滚动时噪声形变较快；离开首屏后放慢，随页面缓慢漂移
      gl.uniform1f(uScroll, Math.min(page, 1) * 2 + Math.max(page - 1, 0) * 0.7);
      gl.uniform1f(uAmbient, amb);
      gl.uniform1f(uIntro, it.value);
      gl.uniform3fv(uBg, hero.bg);
      gl.uniform3fv(uMid, mix3(hero.mid, ap.mid, amb));
      gl.uniform3fv(uHi, mix3(hero.hi, ap.hi, amb));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      // 不调用 loseContext：StrictMode 重新挂载时会拿回同一个已丢失的上下文。
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, []);

  return <canvas ref={ref} className="dither" aria-hidden="true" />;
}
