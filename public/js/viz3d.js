// 3D toolpath viewer — dependency-free orbit camera on a 2D canvas.
// Orthographic projection of a Z-up model. Left-drag = orbit, wheel = zoom,
// shift/middle-drag = pan. Works fully offline (no WebGL / no CDN).

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const MAX_SORT = 30000; // skip painter's depth sort above this many segments

export class Visualizer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.segments = [];
    this.bounds = { minX: -10, minY: -10, minZ: -10, maxX: 10, maxY: 10, maxZ: 10 };
    // Default camera reads like the 2D top view (X→right, Y→up) tilted back to
    // reveal Z. A large azimuth swings X downward and looks "swapped", so keep
    // the yaw small and the elevation fairly top-down.
    this.az = -0.3; // azimuth (rad)
    this.el = 1.15; // elevation (rad); π/2 = top-down
    this.scale = 6;
    this.ox = 0;
    this.oy = 0;
    this.tool = { x: 0, y: 0, z: 0 };
    this.target = { x: 0, y: 0, z: 0 };
    this.dpr = window.devicePixelRatio || 1;
    this.active = false;

    this._initInteraction();
    const ro = new ResizeObserver(() => {
      this._resize();
      if (this.active) this.draw();
    });
    ro.observe(canvas);
    this._resize();
    this.fit();
  }

  setActive(on) {
    this.active = on;
    if (on) {
      this._resize();
      this.draw();
    }
  }

  setGcode(parsed) {
    this.segments = parsed.segments;
    this.bounds = parsed.bounds;
    this.fit();
  }

  setTool(x, y, z) {
    this.tool = { x, y, z: z ?? this.tool.z };
    if (this.active) this.draw();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width || 600;
    this.h = rect.height || 400;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // world (x,y,z) -> { rx (screen-right), up (screen-up), depth } in world units
  _rotate(x, y, z) {
    const px = x - this.target.x;
    const py = y - this.target.y;
    const pz = z - this.target.z;
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const x1 = px * ca - py * sa;
    const y1 = px * sa + py * ca;
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    const depth = y1 * ce - pz * se;
    const up = y1 * se + pz * ce;
    return { rx: x1, up, depth };
  }

  _projectedMid() {
    const b = this.bounds;
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    for (const x of [b.minX, b.maxX]) {
      for (const y of [b.minY, b.maxY]) {
        for (const z of [b.minZ, b.maxZ]) {
          const { rx, up } = this._rotate(x, y, z);
          if (rx < minR) minR = rx;
          if (rx > maxR) maxR = rx;
          if (up < minU) minU = up;
          if (up > maxU) maxU = up;
        }
      }
    }
    return { midR: (minR + maxR) / 2, midU: (minU + maxU) / 2, spanR: maxR - minR || 1, spanU: maxU - minU || 1 };
  }

  _toScreen(x, y, z) {
    const { rx, up, depth } = this._rotate(x, y, z);
    return {
      sx: this.w / 2 + (rx - this._midR) * this.scale + this.ox,
      sy: this.h / 2 - (up - this._midU) * this.scale + this.oy,
      depth,
    };
  }

  fit() {
    const b = this.bounds;
    this.target = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
    const m = this._projectedMid();
    this.scale = Math.min(this.w / (m.spanR * 1.3), this.h / (m.spanU * 1.3)) || 6;
    this.ox = 0;
    this.oy = 0;
    if (this.active) this.draw();
  }

  _initInteraction() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.draw();
    }, { passive: false });

    let mode = null;
    let lastX = 0, lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      mode = e.shiftKey || e.button === 1 ? 'pan' : 'orbit';
      lastX = e.clientX;
      lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (mode === 'pan') {
        this.ox += dx;
        this.oy += dy;
      } else {
        this.az += dx * 0.01;
        this.el = Math.max(0.02, Math.min(Math.PI / 2, this.el - dy * 0.01));
      }
      this.draw();
    });
    const end = () => { mode = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const m = this._projectedMid();
    this._midR = m.midR;
    this._midU = m.midU;

    this._drawGround();
    this._drawAxes();
    this._drawPath();
    this._drawTool();
  }

  _drawGround() {
    const ctx = this.ctx;
    const b = this.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10);
    const step = this._niceStep(span);
    const x0 = Math.floor(b.minX / step) * step;
    const x1 = Math.ceil(b.maxX / step) * step;
    const y0 = Math.floor(b.minY / step) * step;
    const y1 = Math.ceil(b.maxY / step) * step;
    ctx.strokeStyle = '#1b232e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1e-6; x += step) {
      const a = this._toScreen(x, y0, 0);
      const b2 = this._toScreen(x, y1, 0);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b2.sx, b2.sy);
    }
    for (let y = y0; y <= y1 + 1e-6; y += step) {
      const a = this._toScreen(x0, y, 0);
      const b2 = this._toScreen(x1, y, 0);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b2.sx, b2.sy);
    }
    ctx.stroke();
  }

  _niceStep(target) {
    const t = target / 10;
    const pow = Math.pow(10, Math.floor(Math.log10(t)));
    return [1, 2, 5, 10].map((mm) => mm * pow).find((c) => c >= t) || 10 * pow;
  }

  _drawAxes() {
    const ctx = this.ctx;
    const b = this.bounds;
    const len = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 10) * 0.25;
    const o = this._toScreen(0, 0, 0);
    const axis = (x, y, z, color) => {
      const p = this._toScreen(x, y, z);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.sx, o.sy);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
    };
    axis(len, 0, 0, css('--x') || '#f87171');
    axis(0, len, 0, css('--y') || '#4ade80');
    axis(0, 0, len, css('--z') || '#60a5fa');
  }

  _drawPath() {
    const ctx = this.ctx;
    const cut = css('--accent') || '#2dd4bf';
    const projected = [];
    let minD = Infinity, maxD = -Infinity;
    for (const s of this.segments) {
      const a = this._toScreen(s.x0, s.y0, s.z0);
      const b = this._toScreen(s.x1, s.y1, s.z1);
      const depth = (a.depth + b.depth) / 2;
      if (depth < minD) minD = depth;
      if (depth > maxD) maxD = depth;
      projected.push({ a, b, depth, rapid: s.rapid });
    }
    if (projected.length <= MAX_SORT) projected.sort((p, q) => q.depth - p.depth); // far first

    const range = maxD - minD || 1;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    for (const p of projected) {
      ctx.beginPath();
      if (p.rapid) {
        ctx.strokeStyle = '#3a4757';
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 4]);
      } else {
        // depth cue: nearer segments brighter
        const t = (maxD - p.depth) / range; // 1 = nearest
        ctx.strokeStyle = cut;
        ctx.globalAlpha = 0.45 + 0.55 * t;
        ctx.setLineDash([]);
      }
      ctx.moveTo(p.a.sx, p.a.sy);
      ctx.lineTo(p.b.sx, p.b.sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  _drawTool() {
    const ctx = this.ctx;
    const t = this._toScreen(this.tool.x, this.tool.y, this.tool.z);
    const ground = this._toScreen(this.tool.x, this.tool.y, 0);
    const color = css('--accent-2') || '#38bdf8';
    // drop line to z=0 for spatial reference
    ctx.strokeStyle = color + '66';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(t.sx, t.sy);
    ctx.lineTo(ground.sx, ground.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    // tool marker
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(t.sx, t.sy, 5, 0, Math.PI * 2);
    ctx.fill();
    // ground dot
    ctx.fillStyle = color + '55';
    ctx.beginPath();
    ctx.arc(ground.sx, ground.sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
