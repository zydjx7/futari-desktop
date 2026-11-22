import { test } from "node:test";
import assert from "node:assert/strict";
import { alphaRuns, alphaRunsBox, field, location } from "../ui/geometry.js";
test("transparent gap between ears stays clickable underneath", () => {
  const rgba = new Uint8ClampedArray(4 * 5 * 5);
  for (const i of [6, 8, 11, 12, 13]) rgba[i * 4 + 3] = 255;
  const { rows } = alphaRuns(rgba, 5, 5, 5, 1);
  const isHit = (x, y) =>
    rows.some(([l, t, r, b]) => l <= x && x < r && t <= y && y < b);
  assert.equal(isHit(2, 1), false);
  assert.equal(isHit(2, 2), true);
  assert.equal(isHit(1, 1), true);
  assert.equal(isHit(0, 0), false);
});
test("physical taskbar edge with 150% DPI and negative monitor origin", () => {
  const v = {
    display: {
      screen: { x: -1920, y: 0, w: 1920, h: 1080 },
      work: { x: -1920, y: 0, w: 1920, h: 1020 },
    },
    settings: { mode: "overlay", patrol: "taskbar" },
  };
  const f = field(v, 1280, 720, 1.5);
  assert.equal(location(f, 0.5, 0.78).ground, 680);
});
test("rectangular alphaRunsBox supports desktop multi-prop hit masks", () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 3);
  rgba[(0 * 4 + 0) * 4 + 3] = 255;
  rgba[(2 * 4 + 3) * 4 + 3] = 255;
  const { w, h, rows } = alphaRunsBox(rgba, 4, 3, 40, 30, 1);
  assert.deepEqual([w, h], [40, 30]);
  assert.deepEqual(rows, [
    [0, 0, 10, 10],
    [30, 20, 40, 30],
  ]);
});
