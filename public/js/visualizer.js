// 2D top-down toolpath visualizer with auto-fit, wheel zoom and drag pan.
// World coordinates are in mm (work coordinate system). +Y is up.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.segments = [];
    this.bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    this.scale = 4;
    this.tx = 0;
    this.ty = 0;
    this.tool = { x: 0, y: 0 };
    this.dpr = window.devicePixelRatio || 1;

    this._initInteraction();
    const ro = new ResizeObserver(() => {
      this._resize();
      this.draw();
    });
    ro.observe(canvas);
    this._resize();
    this.fit();
  }

  setGcode(parsed) {
    this.segments = parsed.segments;
    this.bounds = parsed.bounds;
    this.fit();
  }

  setTool(x, y) {
    this.tool = { x, y };
    this.draw();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  fit() {
    const b = this.bounds;
    const pad = 0.12;
    const bw = (b.maxX - b.minX) || 20;
    const bh = (b.maxY - b.minY) || 20;
    this.scale = Math.min(this.w / (bw * (1 + 2 * pad)), this.h / (bh * (1 + 2 * pad))) || 4;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.tx = this.w / 2 - cx * this.scale;
    this.ty = this.h / 2 + cy * this.scale;
    this.draw();
  }

  _toScreen(x, y) {
    return [x * this.scale + this.tx, -y * this.scale + this.ty];
  }

  _initInteraction() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      // keep the world point under the cursor fixed
      const wx = (mx - this.tx) / this.scale;
      const wy = (this.ty - my) / this.scale;
      this.scale *= factor;
      this.tx = mx - wx * this.scale;
      this.ty = my + wy * this.scale;
      this.draw();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.tx += e.clientX - lastX;
      this.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.draw();
    });
    const end = () => { dragging = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this._drawGrid();
    this._drawAxes();

    // toolpath
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    const cut = css('--accent') || '#2dd4bf';
    const rapid = '#3a4757';
    for (const s of this.segments) {
      const [x0, y0] = this._toScreen(s.x0, s.y0);
      const [x1, y1] = this._toScreen(s.x1, s.y1);
      ctx.beginPath();
      if (s.rapid) {
        ctx.strokeStyle = rapid;
        ctx.setLineDash([4, 4]);
      } else {
        ctx.strokeStyle = cut;
        ctx.setLineDash([]);
      }
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    this._drawTool();
  }

  _niceStep() {
    // grid spacing targeting ~70px on screen, snapped to 1/2/5 × 10^n
    const target = 70 / this.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const candidates = [1, 2, 5, 10].map((m) => m * pow);
    return candidates.find((c) => c >= target) || 10 * pow;
  }

  _drawGrid() {
    const ctx = this.ctx;
    const step = this._niceStep();
    const left = (-this.tx) / this.scale;
    const right = (this.w - this.tx) / this.scale;
    const top = (this.ty) / this.scale;
    const bottom = (this.ty - this.h) / this.scale;

    ctx.strokeStyle = '#1b232e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      const [sx] = this._toScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      const [, sy] = this._toScreen(0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
    }
    ctx.stroke();
  }

  _drawAxes() {
    const ctx = this.ctx;
    const [ox, oy] = this._toScreen(0, 0);
    ctx.lineWidth = 1.5;
    // X axis (red)
    ctx.strokeStyle = css('--x') || '#f87171';
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(this.w, oy);
    ctx.stroke();
    // Y axis (green)
    ctx.strokeStyle = css('--y') || '#4ade80';
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, this.h);
    ctx.stroke();
    // origin marker
    ctx.fillStyle = '#e6edf3';
    ctx.beginPath();
    ctx.arc(ox, oy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawTool() {
    const ctx = this.ctx;
    const [tx, ty] = this._toScreen(this.tool.x, this.tool.y);
    ctx.strokeStyle = css('--accent-2') || '#38bdf8';
    ctx.fillStyle = (css('--accent-2') || '#38bdf8') + '33';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tx, ty, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx - 11, ty);
    ctx.lineTo(tx + 11, ty);
    ctx.moveTo(tx, ty - 11);
    ctx.lineTo(tx, ty + 11);
    ctx.stroke();
  }
}
