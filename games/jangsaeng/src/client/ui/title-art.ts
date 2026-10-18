// Title atmosphere: a night sky with the Old Man Star (노인성, Canopus) low over
// layered ink-wash ridges and drifting mist. Canvas + generated SVG only.
import { h, s } from "./dom.ts";

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise from a seeded lattice. */
function noise1(seed: number): (x: number) => number {
  const r = rng(seed);
  const lattice = Array.from({ length: 64 }, () => r());
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = lattice[((i % 64) + 64) % 64] as number;
    const b = lattice[(((i + 1) % 64) + 64) % 64] as number;
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

function ridgePath(seed: number, base: number, amp: number, freq: number): string {
  const n = noise1(seed);
  const pts: string[] = [];
  const W = 1600;
  for (let x = 0; x <= W; x += 16) {
    const t = x / W;
    const y =
      base -
      amp * (0.62 * n(t * freq) + 0.28 * n(t * freq * 2.7 + 9) + 0.1 * n(t * freq * 7.1 + 3)) -
      amp * 0.35 * Math.sin(t * Math.PI * 1.2 + seed);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M0,600 L${pts.join(" L")} L${W},600 Z`;
}

function mountains(): SVGSVGElement {
  const layers = [
    { seed: 11, base: 420, amp: 210, freq: 3.2, fill: "url(#tm-far)" },
    { seed: 23, base: 470, amp: 170, freq: 4.4, fill: "url(#tm-mid)" },
    { seed: 37, base: 525, amp: 120, freq: 5.6, fill: "url(#tm-near)" },
    { seed: 53, base: 575, amp: 70, freq: 7.5, fill: "#0b0b0d" },
  ];
  const grad = (id: string, top: string, bottom: string) =>
    s("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" },
      s("stop", { offset: "0", "stop-color": top }),
      s("stop", { offset: "1", "stop-color": bottom }));
  const svg = s(
    "svg",
    { class: "title-mountains", viewBox: "0 0 1600 600", preserveAspectRatio: "xMidYMax slice", "aria-hidden": "true" },
    s("defs", null,
      grad("tm-far", "#4a4f63", "#2a2c38"),
      grad("tm-mid", "#2f3242", "#1b1c25"),
      grad("tm-near", "#1d1e26", "#121217"),
      s("linearGradient", { id: "tm-mist", x1: "0", y1: "0", x2: "0", y2: "1" },
        s("stop", { offset: "0", "stop-color": "#dfe3f0", "stop-opacity": "0" }),
        s("stop", { offset: "0.55", "stop-color": "#dfe3f0", "stop-opacity": "0.13" }),
        s("stop", { offset: "1", "stop-color": "#dfe3f0", "stop-opacity": "0" }))),
  );
  layers.forEach((layer, i) => {
    svg.appendChild(s("path", { d: ridgePath(layer.seed, layer.base, layer.amp, layer.freq), fill: layer.fill }));
    if (i < layers.length - 1)
      svg.appendChild(s("rect", { class: `title-mist mist-${i}`, x: "-300", y: String(layer.base - 70), width: "2200", height: "150", fill: "url(#tm-mist)" }));
  });
  return svg;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  warm: boolean;
}

/** Builds the title backdrop; returns the element and a stop() for its loop. */
export function titleBackdrop(reduced: () => boolean): { el: HTMLElement; stop(): void } {
  const canvas = h("canvas", { class: "title-stars", "aria-hidden": "true" });
  const star = h("div", { class: "title-canopus", "aria-hidden": "true" },
    h("span", { class: "canopus-halo" }), h("span", { class: "canopus-core" }), h("span", { class: "canopus-flare" }));
  const el = h("div", { class: "title-backdrop" }, canvas, star, mountains(), h("div", { class: "title-vignette" }));
  const r = rng(1361);
  const stars: Star[] = Array.from({ length: 260 }, () => ({
    x: r(),
    y: Math.pow(r(), 1.6) * 0.78,
    r: r() < 0.08 ? 1.4 + r() : 0.5 + r() * 0.8,
    phase: r() * Math.PI * 2,
    speed: 0.4 + r() * 1.6,
    warm: r() < 0.18,
  }));
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let stopped = false;
  let w = 0;
  let hgt = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = el.clientWidth || window.innerWidth;
    hgt = el.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = (t: number) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, hgt);
    // Milky band: faint diagonal haze.
    const band = ctx.createLinearGradient(0, hgt * 0.1, w, hgt * 0.5);
    band.addColorStop(0, "rgba(120,130,170,0)");
    band.addColorStop(0.5, "rgba(150,160,200,0.06)");
    band.addColorStop(1, "rgba(120,130,170,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, hgt);
    for (const st of stars) {
      const tw = reduced() ? 0.8 : 0.55 + 0.45 * Math.sin(st.phase + (t / 1000) * st.speed);
      ctx.globalAlpha = Math.max(0.12, tw);
      ctx.fillStyle = st.warm ? "#ffe6b8" : "#e8ecff";
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * hgt, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const loop = (t: number) => {
    raf = 0;
    if (stopped || !el.isConnected) return;
    draw(t);
    if (!reduced()) raf = requestAnimationFrame(loop);
  };
  const onResize = () => {
    resize();
    draw(performance.now());
  };
  window.addEventListener("resize", onResize);
  requestAnimationFrame(() => {
    resize();
    raf = requestAnimationFrame(loop);
  });
  return {
    el,
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}
