import { useEffect, useRef } from "react";

// 开场背景：与首屏 DitherField 同一套 Bayer 抖动语言，但由时间轴驱动——
// energy 控制噪声强度，flood 是从中心铺开的抖动橙色圆幕，ring 是每个节拍的冲击波。
export type FieldFx = { energy: number; flood: number; ring: number; ringAmp: number };

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uEnergy;
uniform float uFlood;
uniform float uRing;
uniform float uRingAmp;
uniform vec3 uBg;
uniform vec3 uMid;
uniform vec3 uHi;
uniform vec3 uAcc;
uniform vec3 uInk;

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
  for (int i = 0; i < 4; i++) {
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
  vec2 c = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float d = length(c);

  // 冲击波：环形波峰把噪声场向外推
  float wave = exp(-pow((d - uRing) * 7.0, 2.0)) * uRingAmp;
  vec2 p = c * 1.9 + normalize(c + 1e-4) * wave * 0.35;

  float t = uTime * 0.14;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p + 3.4 * q + vec2(1.7, 9.2) + 0.5 * t);

  float v = pow(smoothstep(0.3, 0.88, f), 1.2) * 1.5;
  v *= mix(0.12, 1.0, smoothstep(0.16, 0.72, d));
  v = v * uEnergy + wave * 0.85;

  float b = bayer8(gl_FragCoord.xy);
  float k = floor(clamp(v, 0.0, 0.999) * 2.0 + b);
  float inFlood = step(b, 1.0 - smoothstep(uFlood - 0.22, uFlood, d));

  vec3 base = mix(uBg, uAcc, inFlood);
  vec3 mid = mix(uMid, mix(uAcc, uInk, 0.28), inFlood);
  vec3 hi = mix(uHi, mix(uAcc, uInk, 0.62), inFlood);
  gl_FragColor = vec4(k < 0.5 ? base : (k < 1.5 ? mid : hi), 1.0);
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

const mix3 = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);

export default function LoaderField({ fx }: { fx: { current: FieldFx } }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const cs = getComputedStyle(canvas);
    const dark = !!canvas.closest('[data-theme="dark"]');
    const bg = toRgb(cs.getPropertyValue("--h-bg"));
    const accent = toRgb(cs.getPropertyValue("--h-accent"));
    const fg = toRgb(cs.getPropertyValue("--h-fg"));
    gl.uniform3fv(u("uBg"), bg);
    gl.uniform3fv(u("uMid"), mix3(bg, accent, dark ? 0.82 : 0.9));
    gl.uniform3fv(u("uHi"), mix3(accent, fg, dark ? 0.55 : 0.35));
    gl.uniform3fv(u("uAcc"), accent);
    gl.uniform3fv(u("uInk"), [11 / 255, 11 / 255, 10 / 255]);
    const uRes = u("uRes"),
      uTime = u("uTime"),
      uEnergy = u("uEnergy"),
      uFlood = u("uFlood"),
      uRing = u("uRing"),
      uRingAmp = u("uRingAmp");

    const pixel = window.innerWidth < 700 ? 3 : 4;
    const resize = () => {
      canvas.width = Math.max(1, Math.ceil(canvas.clientWidth / pixel));
      canvas.height = Math.max(1, Math.ceil(canvas.clientHeight / pixel));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const f = fx.current;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000 + 8);
      gl.uniform1f(uEnergy, f.energy);
      gl.uniform1f(uFlood, f.flood);
      gl.uniform1f(uRing, f.ring);
      gl.uniform1f(uRingAmp, f.ringAmp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [fx]);

  return <canvas ref={ref} className="ld-field" aria-hidden="true" />;
}
