export function clearPack(strip = false) {
  return {
    floor: () => (strip ? 0.77 : 0.25),
    depth: () => 0.75,
    wander(i, x) {
      if (i % 5 === 1) return { key: "peek" };
      if (i % 5 === 3) return { key: "back" };
      const xx =
        x > 0.5 ? 0.12 + Math.random() * 0.24 : 0.62 + Math.random() * 0.24;
      return {
        key: "go",
        x: xx,
        y: strip ? 0.78 : 0.3 + Math.random() * 0.6,
        gait: i % 3 === 0 ? "walk" : "hop",
        after: i % 3 === 1 ? "rest" : "peek",
      };
    },
  };
}
export function field(view, width, height, ratio) {
  const { screen, work } = view.display,
    s = view.settings;
  const workBox = {
    x: (work.x - screen.x) / ratio,
    y: (work.y - screen.y) / ratio,
    w: work.w / ratio,
    h: work.h / ratio,
  };
  const base = Math.max(48, Math.min(82, width * 0.1, height * 0.13));
  if (s.mode === "desktop")
    return {
      ...workBox,
      size: Math.min(base * 1.5, workBox.h * 0.22),
      strip: false,
    };
  if (s.patrol === "full") return { ...workBox, size: base, strip: false };
  if (s.patrol === "corner") {
    const w = Math.min(330, workBox.w),
      h = Math.min(216, workBox.h);
    return {
      x: workBox.x + workBox.w - w,
      y: workBox.y + workBox.h - h,
      w,
      h,
      size: Math.min(base, w * 0.24, h * 0.4),
      strip: false,
    };
  }
  if (s.patrol === "custom" && s.fence) {
    const f = s.fence,
      w = f.w * width,
      h = f.h * height;
    return {
      x: f.x * width,
      y: f.y * height,
      w,
      h,
      size: Math.min(base, w * 0.33, h * 0.6),
      strip: false,
    };
  }
  return {
    x: workBox.x,
    y: workBox.y + workBox.h - base * 1.65,
    w: workBox.w,
    h: base * 1.65,
    size: base,
    strip: true,
  };
}
export function location(field, x, y) {
  const pad = Math.min(field.w * 0.45, field.size * 0.74),
    head = Math.min(field.h - 1, field.size * 1.35);
  return {
    x: field.x + pad + x * (field.w - 2 * pad),
    ground: field.y + (field.strip ? field.h : head + y * (field.h - head)),
  };
}
export function inverse(field, x, y) {
  const pad = Math.min(field.w * 0.45, field.size * 0.74),
    head = Math.min(field.h - 1, field.size * 1.35);
  return {
    x: Math.max(
      0.01,
      Math.min(0.99, (x - field.x - pad) / Math.max(1, field.w - 2 * pad)),
    ),
    y: field.strip
      ? 0.78
      : Math.max(
          0.01,
          Math.min(0.98, (y - field.y - head) / Math.max(1, field.h - head)),
        ),
  };
}
// Each run is inward-rounded. Transparent gaps between ears stay open to other applications.
export function alphaRuns(pixels, n, cssW, cssH, dpr, occludes) {
  const w = Math.round(cssW * dpr),
    h = Math.round(cssH * dpr),
    rows = [],
    prev = new Map();
  for (let y = 0; y < n; y++) {
    const top = Math.round((y * h) / n),
      bottom = Math.round(((y + 1) * h) / n);
    if (top === bottom) continue;
    const next = new Map();
    for (let x = 0; x < n; ) {
      const on = (i) =>
        pixels[4 * (y * n + i) + 3] > 36 &&
        !occludes?.((i + 0.5) / n, (y + 0.5) / n);
      if (!on(x)) {
        x++;
        continue;
      }
      const start = x++;
      while (x < n && on(x)) x++;
      const l = Math.ceil((start * w) / n),
        r = Math.floor((x * w) / n);
      if (r <= l) continue;
      const key = l + "," + r;
      let row = prev.get(key);
      if (row && row[3] === top) row[3] = bottom;
      else {
        row = [l, top, r, bottom];
        rows.push(row);
      }
      next.set(key, row);
    }
    prev.clear();
    for (const [k, v] of next) prev.set(k, v);
  }
  return { w, h, rows };
}
export function alphaRunsBox(pixels, cols, rowsN, cssW, cssH, dpr) {
  const w = Math.max(1, Math.round(cssW * dpr)),
    h = Math.max(1, Math.round(cssH * dpr)),
    rows = [],
    prev = new Map();
  for (let y = 0; y < rowsN; y++) {
    const top = Math.round((y * h) / rowsN),
      bottom = Math.round(((y + 1) * h) / rowsN);
    if (top === bottom) continue;
    const next = new Map();
    for (let x = 0; x < cols; ) {
      if (pixels[4 * (y * cols + x) + 3] <= 36) {
        x++;
        continue;
      }
      const start = x++;
      while (x < cols && pixels[4 * (y * cols + x) + 3] > 36) x++;
      const l = Math.ceil((start * w) / cols),
        r = Math.floor((x * w) / cols);
      if (r <= l) continue;
      const key = l + "," + r;
      let row = prev.get(key);
      if (row && row[3] === top) row[3] = bottom;
      else {
        row = [l, top, r, bottom];
        rows.push(row);
      }
      next.set(key, row);
    }
    prev.clear();
    for (const [k, v] of next) prev.set(k, v);
  }
  return { w, h, rows };
}
