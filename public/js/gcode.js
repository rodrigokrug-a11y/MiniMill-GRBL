// Lightweight G-code parser for the toolpath preview (2D and 3D).
// Produces line segments (arcs linearized) in the work coordinate system,
// plus XYZ bounds. Handles G0/G1/G2/G3, G90/G91, G20/G21 and modal motion.

const ARC_SEG = Math.PI / 36; // ~5° per linearized arc segment

export function parseGcode(text) {
  const segments = [];
  const bounds = {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
  };
  let pos = { x: 0, y: 0, z: 0 };
  let abs = true;
  let unitsMM = true;
  let motion = 0;
  let lineCount = 0;

  const grow = (x, y, z) => {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (z < bounds.minZ) bounds.minZ = z;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
    if (z > bounds.maxZ) bounds.maxZ = z;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    if (!line) continue;
    lineCount++;

    const tokens = line.toUpperCase().match(/([A-Z])\s*(-?\d*\.?\d+)/g);
    if (!tokens) continue;

    const words = {};
    const gCodes = [];
    for (const t of tokens) {
      const letter = t[0];
      const value = parseFloat(t.slice(1));
      if (letter === 'G') gCodes.push(value);
      else words[letter] = value;
    }

    for (const g of gCodes) {
      if (g === 90) abs = true;
      else if (g === 91) abs = false;
      else if (g === 20) unitsMM = false;
      else if (g === 21) unitsMM = true;
      else if (g === 0 || g === 1 || g === 2 || g === 3) motion = g;
    }

    const scale = unitsMM ? 1 : 25.4;
    const has = (k) => words[k] !== undefined;
    const target = (k, cur) => (has(k) ? (abs ? words[k] * scale : cur + words[k] * scale) : cur);

    if (!(has('X') || has('Y') || has('Z') || has('I') || has('J') || has('R'))) continue;

    const next = { x: target('X', pos.x), y: target('Y', pos.y), z: target('Z', pos.z) };

    if (motion === 0 || motion === 1) {
      segments.push({ x0: pos.x, y0: pos.y, z0: pos.z, x1: next.x, y1: next.y, z1: next.z, rapid: motion === 0 });
      grow(pos.x, pos.y, pos.z);
      grow(next.x, next.y, next.z);
    } else {
      // G2 (CW) / G3 (CCW) arc in the XY plane (helical Z interpolated).
      const cw = motion === 2;
      let cx, cy;
      if (has('I') || has('J')) {
        cx = pos.x + (words.I || 0) * scale;
        cy = pos.y + (words.J || 0) * scale;
      } else if (has('R')) {
        const r = words.R * scale;
        const dx = next.x - pos.x;
        const dy = next.y - pos.y;
        const d = Math.hypot(dx, dy);
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
        const sign = (r < 0 ? -1 : 1) * (cw ? -1 : 1);
        cx = (pos.x + next.x) / 2 + (sign * h * -dy) / (d || 1);
        cy = (pos.y + next.y) / 2 + (sign * h * dx) / (d || 1);
      } else {
        cx = pos.x;
        cy = pos.y;
      }

      const radius = Math.hypot(pos.x - cx, pos.y - cy);
      const a0 = Math.atan2(pos.y - cy, pos.x - cx);
      const a1 = Math.atan2(next.y - cy, next.x - cx);
      let sweep = a1 - a0;
      if (cw && sweep >= 0) sweep -= 2 * Math.PI;
      if (!cw && sweep <= 0) sweep += 2 * Math.PI;

      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_SEG));
      let prev = { x: pos.x, y: pos.y, z: pos.z };
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const a = a0 + sweep * t;
        const px = cx + radius * Math.cos(a);
        const py = cy + radius * Math.sin(a);
        const pz = pos.z + (next.z - pos.z) * t;
        segments.push({ x0: prev.x, y0: prev.y, z0: prev.z, x1: px, y1: py, z1: pz, rapid: false });
        grow(px, py, pz);
        prev = { x: px, y: py, z: pz };
      }
      grow(pos.x, pos.y, pos.z);
    }

    pos = next;
  }

  if (!isFinite(bounds.minX)) {
    bounds.minX = bounds.minY = bounds.minZ = -10;
    bounds.maxX = bounds.maxY = bounds.maxZ = 10;
  }
  return { segments, bounds, lineCount };
}
