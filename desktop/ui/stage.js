import art from "./vendor/layout.js";
import actions from "./vendor/action-layout.js";
import { Puppet, clamp, ease, foreContact, poseCels } from "./vendor/motion.js";
import { RabbitLife } from "./vendor/movement.js";
import { createPaper } from "./vendor/scenes/paper.js";
import { createSnow } from "./vendor/scenes/snow.js";
import { bowl, tunnelBack, tunnelFront, tunnelPlacement, nightLight } from "./vendor/props.js";
import { daylight, lightWash, nightFigure, nightPrint } from "./vendor/light.js";
import {
  icons as iconMap,
  paintIcon,
  paintWillow,
  willowShape,
  willowRestAngle,
} from "./vendor/stationery.js";
import { configureAlbum } from "./vendor/paper.js";
import { createCamera } from "./vendor/camera.js";
import { canvasToBase64, savePolaroidPrint } from "./album-bridge.js";
import {
  alphaRuns,
  alphaRunsBox,
  field,
  location,
  inverse,
  clearPack,
} from "./geometry.js";

const { invoke } = window.__TAURI__.core,
  { listen } = window.__TAURI__.event;

if (/Mac/.test(navigator.platform)) document.documentElement.classList.add("appkit-stage");

const world = document.querySelector("#world"),
  pet = document.querySelector("#pet"),
  sel = document.querySelector("#selection"),
  playBar = document.querySelector("#play-bar"),
  cameraHost = document.querySelector("#camera-host"),
  foodGhost = document.querySelector("#food-ghost");

const stamp = document.createElement("canvas"),
  mask = document.createElement("canvas");
const actor = stamp.getContext("2d"),
  hitCtx = mask.getContext("2d", { willReadFrequently: true }),
  ink = pet.getContext("2d"),
  terrain = world.getContext("2d");

async function image(src) {
  const im = new Image();
  im.src = src;
  await im.decode();
  return im;
}

const [atlas, icons, limbs, paperTex] = await Promise.all(
  ["caramel", "stationery", "actions", "paper"].map((n) =>
    image("./art/" + n + ".webp"),
  ),
);

function propSprite(fn, x, y, w, h, grain) {
  const tile = document.createElement("canvas"),
    scale = 0.65;
  tile.width = Math.ceil(w * scale);
  tile.height = Math.ceil(h * scale);
  const ctx = tile.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  fn(ctx);
  if (grain) {
    const pixels = ctx.getImageData(0, 0, tile.width, tile.height);
    for (let row = 0; row < tile.height; row++) {
      for (let col = 0; col < tile.width; col++) {
        const i = (row * tile.width + col) * 4;
        if (!pixels.data[i + 3]) continue;
        const fleck =
          (grain.data[
            ((row % grain.height) * grain.width + (col % grain.width)) * 4 + 1
          ] -
            243) *
          1.6;
        for (let k = 0; k < 3; k++) pixels.data[i + k] += fleck;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return tile;
}

const grain = (() => {
  const sw = document.createElement("canvas");
  sw.width = paperTex.width;
  sw.height = paperTex.height;
  const g = sw.getContext("2d");
  g.drawImage(paperTex, 0, 0);
  return g.getImageData(0, 0, paperTex.width, paperTex.height);
})();

const sprites = {
  bowl: propSprite(bowl, 110, 680, 270, 158, grain),
  back: propSprite(tunnelBack, 1095, 425, 474, 412, grain),
  tunnel: propSprite(tunnelFront, 1095, 425, 474, 412, grain),
  lamp: propSprite(nightLight, 875, 250, 320, 330),
};
const rim = sprites.tunnel;
const rimPixels = rim.getContext("2d").getImageData(0, 0, rim.width, rim.height).data;
const paperPattern = terrain.createPattern(paperTex, "repeat");
const puppet = new Puppet(atlas, art, { ...actions, image: limbs });
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

configureAlbum({
  async uploadShot(shot) {
    const imageBase64 = await canvasToBase64(shot.photo);
    return invoke("album_upload", {
      meta: {
        id: shot.id,
        captured: shot.captured,
        offset: shot.offset,
        scene: shot.scene,
        light: shot.light,
        pose: shot.pose,
        title: shot.title,
      },
      imageBase64,
    });
  },
  downloadPrint: savePolaroidPrint,
});

let scene = null,
  view = null,
  currentKey = "",
  currentSceneId = "clear",
  generation = 0,
  sceneLoading = Promise.resolve(),
  frame = 0,
  previous = 0,
  lastHit = 0,
  sending = false,
  lastShape = "",
  food = "hay",
  preferredFood = "hay",
  box = null,
  dragOffset = null,
  dragActive = false,
  playCarry = null,
  suppressPlayClick = false,
  things = [],
  layers = [],
  wash = null,
  paperGlow = null,
  paintNightFigure = null,
  currentLight = "day",
  lastLightKey = "",
  draggingFood = false,
  ballX = null,
  ballAngle = willowRestAngle,
  rolling = null,
  lastPush = null,
  bedVisits = 0,
  hoverAt = -9,
  lastPointer = null,
  above = false,
  aboveAt = 0,
  figure = null;

const life = new RabbitLife(clearPack(true), (x, y, dx, dy, n, foot) => {
  if (!scene?.step) return;
  const w = innerWidth,
    h = innerHeight;
  if (w && h) {
    const side = scene.size(w, h, x, y),
      fore = foot === "fore";
    if (life.face.view === "side") {
      const offset = fore ? foreContact(life.state.power) / 220 : -0.18;
      x += (life.face.dir * offset * side) / w;
    } else {
      y +=
        ((life.face.view === "front" ? 1 : -1) *
          (fore ? 0.034 : -0.022) *
          side) /
        h;
    }
  }
  scene.step(x, y, dx, dy, n, life.clock, foot);
});

function workMetrics(v, w, h) {
  const ratio = devicePixelRatio || 1;
  const { screen, work } = v.display;
  const wx = clamp((work.x - screen.x) / (ratio * Math.max(1, w)), 0, 0.5);
  const wy = clamp((work.y - screen.y) / (ratio * Math.max(1, h)), 0, 0.5);
  const ww = clamp(work.w / (ratio * Math.max(1, w)), 0.2, 1 - wx);
  const wh = clamp(work.h / (ratio * Math.max(1, h)), 0.2, 1 - wy);
  return { wx, wy, ww, wh };
}

function ballRange(width, y, w, h) {
  if (!scene || !w || !h) return [0.1, 0.9];
  const clearance = Math.min(
    0.39,
    (0.59 * scene.size(w, h, 0.5, Math.min(0.95, y + 0.09)) + width * 0.45) / w,
  );
  return [0.07 + clearance, 0.93 - clearance];
}

function ballTrip() {
  const w = innerWidth,
    h = innerHeight;
  const ball = things.find((o) => o.name === "ball");
  if (!ball || !scene || !w || !h) return null;
  const bx = rolling?.to ?? (ball.x + ball.w / 2) / w;
  const [left, right] = ballRange(ball.w, ball.base / h, w, h);
  const margin = Math.min((right - left) * 0.35, ball.w / w);
  const dir =
    bx >= right - margin ? -1 : bx <= left + margin ? 1 : life.x < bx ? 1 : -1;
  const face = { view: "side", dir },
    still = {
      ...life.pose(),
      pitch: 0,
      height: 0,
      squash: 0,
      push: 0,
      sniff: 0,
      breath: 0,
    };
  const arrivalAngle = rolling
    ? rolling.angle + ((bx - rolling.from) * w) / (0.42 * ball.w)
    : ballAngle;
  const edge = willowShape(bx * w, ball.base, ball.w, arrivalAngle).edge(dir);
  const nose = puppet.landmark("nose", face, still, "noseLow");
  let x = bx,
    y = ball.base / h;
  for (let i = 0; i < 5; i++) {
    const scale = scene.size(w, h, x, y) / 220;
    x = clamp((edge.x - (nose.x + dir * 3) * scale) / w, 0.07, 0.93);
    y = clamp((edge.y - nose.y * scale) / h, scene.floor(x), 0.952);
  }
  return { key: "go", x, y, after: { key: "nudge", dir } };
}

life.habitat = () => {
  if (!scene?.props) return {};
  const h = innerHeight || 1;
  const bed = things.find((o) => o.name === "bed");
  const [bx, by] = scene.props.bowl;
  return {
    ball: ballTrip(),
    bed: bed && { key: "go", x: scene.props.bed[0], y: bed.base / h - 0.008 },
    bowl: {
      key: "go",
      x: bx + 0.065,
      y: by - 0.012,
      after: { key: "sniff", dir: -1 },
    },
    ownsBed: (view?.placed || []).includes("bed"),
    night: currentLight === "night",
  };
};

function layout() {
  things = [];
  layers = [];
  wash = null;
  paperGlow = null;
  if (!scene || !view) return;
  const w = innerWidth,
    h = innerHeight;
  if (!w || !h) return;
  currentLight = daylight(view.atmosphere || "auto");
  lastLightKey = (view.atmosphere || "auto") + ":" + currentLight;
  const placed = view.placed || [];
  const unit = Math.min(w, h * 1.45) * (scene.propScale ?? 0.79);
  for (const [name, [x, z]] of Object.entries(scene.props || {})) {
    if ((name === "ball" || name === "bed") && !placed.includes(name)) continue;
    if (name === "lamp" && currentLight !== "night") continue;
    const approachY = z + 0.04;
    let width, left;
    if (name === "tunnel") {
      let entryX = x;
      for (let i = 0; i < 3; i++) {
        width = (scene.size(w, h, entryX, approachY) * 1.085 * 474) / 258;
        left = Math.max(0, Math.min(w * x - width / 2, w * 0.986 - width));
        entryX = (left + 0.348 * width) / w;
      }
    } else {
      width = unit * { bowl: 0.143, bed: 0.255, ball: 0.084, lamp: 0.19 }[name];
    }
    const tile = sprites[name],
      height = tile ? (width * tile.height) / tile.width : width;
    const base = z * h,
      bottom = base + (name === "bed" ? height * 0.17 : 0);
    if (name === "ball") ballX = clamp(ballX ?? x, ...ballRange(width, z, w, h));
    things.push({
      name,
      z: name === "bed" ? z - 0.155 : z,
      x: left ?? (name === "ball" ? (ballX ?? x) : x) * w - width / 2,
      y: bottom - height,
      w: width,
      h: height,
      base,
    });
  }
  layers = [...things, ...(scene.landmarks?.() || [])].sort((a, b) => a.z - b.z);
  scene.setLight?.(currentLight);
  wash = lightWash(
    terrain,
    w,
    h,
    currentLight,
    things.find((o) => o.name === "lamp"),
    scene.id === "snow",
  );
  if (scene.id === "paper") {
    paperGlow = terrain.createRadialGradient(
      w * 0.51,
      h * 0.72,
      0,
      w * 0.51,
      h * 0.72,
      Math.max(w, h) * 0.58,
    );
    paperGlow.addColorStop(0, "rgba(226,185,121,.17)");
    paperGlow.addColorStop(1, "rgba(255,248,231,0)");
  }
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  previous = 0;
  lastShape = "";
  dragOffset = null;
  dragActive = false;
  playCarry = null;
  draggingFood = false;
  foodGhost.hidden = true;
  life.held = false;
}

function play() {
  if (!frame && view?.visible && !view.selecting)
    frame = requestAnimationFrame(tick);
}

function size(canvas, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function randomSnow(count) {
  return Array.from({ length: count }, () => [Math.random(), Math.random()]);
}

async function loadLayer(id, layer) {
  const bytes = await invoke("scene_layer", { id, layer });
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  try {
    return await image(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeClearHabitat(v) {
  const w = innerWidth || 1280,
    h = innerHeight || 720;
  const { wx, wy, ww, wh } = workMetrics(v, w, h);
  const floor = () => wy + wh * 0.56;
  return {
    id: "paper",
    transparent: true,
    propScale: 0.79 * Math.min(ww, wh),
    floor,
    depth: (_, y) => clamp((y - floor()) / Math.max(0.05, wh * 0.39)),
    size: (vw, vh, _x, y) => {
      const t = clamp((wy + wh * 0.74 - y) / Math.max(0.05, wh * 0.16));
      return (
        Math.min(wh * vh * 0.34, ww * vw * 0.36) *
        (1 - 0.32 * t * t * (3 - 2 * t))
      );
    },
    props: {
      bowl: [wx + 0.13 * ww, wy + 0.89 * wh],
      tunnel: [wx + 0.85 * ww, wy + 0.66 * wh],
      bed: [wx + 0.57 * ww, wy + 0.9 * wh],
      ball: [wx + 0.73 * ww, wy + 0.9 * wh],
      lamp: [wx + 0.61 * ww, wy + 0.7 * wh],
    },
    wander(i, x) {
      if (i % 6 === 1) return { key: "peek" };
      if (i % 6 === 3) return { key: "loaf" };
      if (i % 6 === 5) return { key: "nibble" };
      const xx =
        x > wx + ww * 0.5
          ? wx + ww * (0.18 + Math.random() * 0.22)
          : wx + ww * (0.6 + Math.random() * 0.22);
      return {
        key: "go",
        x: xx,
        y: wy + wh * (0.64 + Math.random() * 0.26),
        gait: "auto",
        arrival: true,
      };
    },
  };
}

function makePaperHabitat(v) {
  const w = innerWidth || 1280,
    h = innerHeight || 720;
  const { wx, wy, ww, wh } = workMetrics(v, w, h);
  const base = createPaper();
  return {
    ...base,
    id: "paper",
    propScale: Math.min(ww, wh),
    floor: (x) => wy + wh * base.floor(x),
    depth: (x, y) =>
      base.depth(x, clamp((y - wy) / Math.max(0.05, wh), 0, 1)),
    size: (vw, vh, x, y) =>
      base.size(
        ww * vw,
        wh * vh,
        clamp((x - wx) / Math.max(0.05, ww), 0, 1),
        clamp((y - wy) / Math.max(0.05, wh), 0, 1),
      ),
    props: Object.fromEntries(
      Object.entries(base.props).map(([k, [px, py]]) => [
        k,
        [wx + px * ww, wy + py * wh],
      ]),
    ),
    wander(i, x) {
      const next = base.wander(
        i,
        clamp((x - wx) / Math.max(0.05, ww), 0, 1),
      );
      return next.x == null
        ? next
        : { ...next, x: wx + next.x * ww, y: wy + next.y * wh };
    },
  };
}

async function makeScene(id, v) {
  if (id === "clear") return makeClearHabitat(v);
  if (id === "paper") return makePaperHabitat(v);
  const packs = await invoke("scene_list");
  const spec = packs.find((p) => p.id === id);
  if (!spec) throw Error("场景包不在目录中");
  if (spec.layout === "snow-forest")
    return createSnow((name) =>
      loadLayer(id, name === "snow-field" ? "bg" : "fg"),
    );
  const [bg, fg] = await Promise.all([
    loadLayer(id, "bg"),
    loadLayer(id, "fg"),
  ]);
  const points = randomSnow(spec.weather === "snow" ? 28 : 0),
    base = clearPack(false);
  const fgMask = document.createElement("canvas");
  fgMask.width = 192;
  fgMask.height = 120;
  const c = fgMask.getContext("2d", { willReadFrequently: true });
  c.drawImage(fg, 0, 0, 192, 120);
  const alpha = c.getImageData(0, 0, 192, 120).data;
  let dims = [1, 1];
  const g0 = spec.horizon + (1 - spec.horizon) * 0.25;
  const g1 = Math.min(0.91, spec.horizon + (1 - spec.horizon) * 0.78);
  return {
    ...base,
    id: "custom",
    propScale: 0.76,
    floor: () => spec.horizon,
    depth: (_, y) =>
      Math.max(0, (y - spec.horizon) / Math.max(0.05, 1 - spec.horizon)),
    size: (w, h, x, y) =>
      Math.min(
        w * 0.25,
        h *
          (0.1 +
            (0.22 * Math.max(0, y - spec.horizon)) /
              Math.max(0.05, 1 - spec.horizon)),
      ),
    props: {
      bowl: [0.14, g1],
      tunnel: [0.84, g0],
      bed: [0.56, g1],
      ball: [0.72, g1],
      lamp: [0.6, (g0 + g1) * 0.5],
    },
    wander(i, x) {
      const next = base.wander(i, x);
      return next.x == null
        ? next
        : {
            ...next,
            y: clamp(next.y, spec.horizon + 0.04, 0.92),
          };
    },
    resize: (w, h) => {
      dims = [w, h];
    },
    background: (ctx, w, h) => ctx.drawImage(bg, 0, 0, w, h),
    landmarks: () => [{ name: "fg", z: spec.foregroundDepth }],
    paintLandmark: (ctx) => ctx.drawImage(fg, 0, 0, ...dims),
    occludes: (x, y, z) => {
      if (
        z >= spec.foregroundDepth ||
        x < 0 ||
        y < 0 ||
        x >= dims[0] ||
        y >= dims[1]
      )
        return false;
      return (
        alpha[
          4 *
            (Math.floor((y / dims[1]) * 120) * 192 +
              Math.floor((x / dims[0]) * 192)) +
            3
        ] > 100
      );
    },
    after(ctx, w, h, t) {
      ctx.fillStyle = "#fffc";
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(
          ((x + t * 0.005) % 1) * w,
          ((y + t * 0.035) % 1) * h,
          1.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    },
    dispose() {
      bg.removeAttribute("src");
      fg.removeAttribute("src");
    },
  };
}

function advanceBall(p, w, h) {
  const o = things.find((thing) => thing.name === "ball");
  if (!o || !scene || !w || !h) return;
  const x = (o.x + o.w / 2) / w;
  if (p.action === "nudge" && p.push > 0.06 && lastPush !== life.state) {
    const side = scene.size(w, h, life.x, life.y),
      dir = life.face.dir;
    const ball = o.shape || willowShape(x * w, o.base, o.w, ballAngle),
      edge = ball.edge(dir);
    const tip = puppet.landmark("nose", life.face, p, "noseLow");
    const nx = life.x * w + (tip.x * side) / 220,
      ny = life.y * h + (tip.y * side) / 220;
    if (
      dir * (nx - edge.x) >= -0.75 &&
      Math.abs(ny - edge.y) <= Math.max(2.5, o.h * 0.12)
    ) {
      lastPush = life.state;
      rolling = {
        from: x,
        to: clamp(
          x + (dir * o.w * 1.15) / w,
          ...ballRange(o.w, o.base / h, w, h),
        ),
        angle: ballAngle,
        at: life.clock,
      };
    }
  }
  if (rolling) {
    const t = clamp((life.clock - rolling.at) / 0.77);
    ballX = rolling.from + (rolling.to - rolling.from) * (1 - (1 - t) ** 3);
    ballAngle = rolling.angle + ((ballX - rolling.from) * w) / (0.42 * o.w);
    o.x = ballX * w - o.w / 2;
    if (t === 1) rolling = null;
  }
  const cx = o.x + o.w / 2;
  if (!o.shape || o.shape.x !== cx || o.shape.angle !== ballAngle)
    o.shape = willowShape(cx, o.base, o.w, ballAngle);
}

function groundThing(c, o) {
  if (!scene?.props?.[o.name]) {
    scene.paintLandmark(c, o);
    return;
  }
  const night = Boolean(wash?.night);
  if (o.name === "ball")
    return paintWillow(c, night ? nightPrint(icons) : icons, o.shape);
  if (o.name === "bed") {
    c.save();
    c.translate(o.x + o.w / 2, o.y + o.h / 2);
    paintIcon(c, night ? nightPrint(icons) : icons, o.name, 0, 0, o.w);
    c.restore();
    return;
  }
  if (o.name === "tunnel" && figure?.p.inside) {
    c.save();
    c.fillStyle = "rgba(60,42,35," + 0.21 * figure.p.inside + ")";
    c.beginPath();
    c.ellipse(
      o.x + o.w * (173 / 474),
      o.y + o.h * (226 / 412),
      o.w * (120 / 474),
      o.h * (133 / 412),
      -0.07,
      0,
      2 * Math.PI,
    );
    c.fill();
    c.restore();
  }
  const tile = sprites[o.name];
  c.drawImage(
    night && o.name !== "lamp" ? nightPrint(tile) : tile,
    o.x,
    o.y,
    o.w,
    o.h,
  );
  if (o.name === "bowl" && life.state.kind === "eat" && life.state.age < 1.2)
    paintIcon(
      c,
      icons,
      food,
      o.x + o.w * 0.5,
      o.y + o.h * 0.28,
      o.w * 0.4,
    );
}

function propAt(x, y, o) {
  if (!o || o.name === "lamp") return false;
  if (o.name === "ball" && o.shape)
    return Math.hypot(x - o.shape.x, y - o.shape.y) <= o.w * 0.48;
  const u = (x - o.x) / o.w,
    v = (y - o.y) / o.h;
  return (
    u >= 0.03 && u <= 0.97 && v >= (o.name === "bed" ? 0.28 : 0.12) && v <= 0.98
  );
}

function hidesPixel(x, y, o) {
  if (o.name !== "tunnel") return propAt(x, y, o);
  const u = Math.floor(((x - o.x) / o.w) * rim.width),
    v = Math.floor(((y - o.y) / o.h) * rim.height);
  return (
    u >= 0 &&
    v >= 0 &&
    u < rim.width &&
    v < rim.height &&
    rimPixels[4 * (v * rim.width + u) + 3] > 96
  );
}

function hitsRabbit(x, y) {
  const f = figure;
  return Boolean(
    f &&
      Math.abs(x - f.cx) < f.size * 0.9 &&
      y > f.base - 1.25 * f.size &&
      y < f.base + 0.07 * f.size &&
      !scene?.occludes?.(x, y, f.z) &&
      !things.some((o) => o.z > f.z && hidesPixel(x, y, o)) &&
      puppet.contains(x, y, f),
  );
}

function target(x, y) {
  if (hitsRabbit(x, y)) {
    const tail =
      figure.face.view === "back" &&
      Math.abs(x - figure.cx) < figure.size * 0.13 &&
      Math.abs(y - (figure.base - 0.18 * figure.size)) < figure.size * 0.13;
    return tail ? "peek" : "pet";
  }
  return [...things].reverse().find((o) => propAt(x, y, o))?.name;
}

function occupied() {
  const next = life.pending;
  return [
    life.state.kind,
    life.state.next,
    life.trip?.after,
    next?.key,
    next?.after,
  ].some((k) => k === "eat" || k === "tunnel");
}

function act(key, item, atBowl = false) {
  if (!figure || occupied()) return false;
  if (key === "pet" && (life.state.kind === "pet" || life.pending?.key === "pet"))
    return false;
  if ((key === "tunnel" || key === "bed") && scene?.props) {
    if (key === "bed" && !(view?.placed || []).includes("bed")) return false;
    const [x, y] = scene.props[key];
    const log = things.find((o) => o.name === "tunnel");
    life.go(
      key === "tunnel" && log ? (log.x + log.w * 0.348) / innerWidth : x,
      key === "tunnel" ? y + 0.04 : y - 0.008,
      key === "tunnel" ? "tunnel" : ["sploot", "flop", "loaf"][bedVisits++ % 3],
    );
  } else if (key === "ball" || key === "nudge") {
    const trip = ballTrip();
    if (!trip) return false;
    life.issue(trip);
  } else if (key === "eat" && atBowl && scene?.props?.bowl) {
    food = item || preferredFood;
    const [x, y] = scene.props.bowl;
    life.go(x + 0.052, y - 0.026, "eat");
  } else {
    if (key === "eat") food = item || preferredFood;
    life.issue({ key });
  }
  play();
  return true;
}

function watchAbove(x, y) {
  if (!figure) return;
  const near =
    Math.abs(x - figure.cx) < figure.size * 0.44 &&
    y < figure.base - 0.77 * figure.size &&
    y > figure.base - 1.59 * figure.size;
  if (near && !above && life.clock - hoverAt > 2) {
    above = true;
    aboveAt = life.clock;
    play();
  }
  if (!near) above = false;
}

function canFeed(x, y) {
  if (!figure) return false;
  return (
    propAt(
      x,
      y,
      things.find((o) => o.name === "bowl"),
    ) ||
    (life.face.view !== "back" &&
      !scene?.occludes?.(x, y, figure.z) &&
      Math.hypot(x - figure.mx, y - figure.my) <
        Math.max(30, figure.size * 0.26))
  );
}

async function handleBowlClick() {
  if (occupied()) return;
  try {
    const reply = await invoke("stage_act", {
      kind: "bowl",
      item: preferredFood,
    });
    if (reply?.fed) {
      preferredFood = reply.fed;
      act("eat", reply.fed, true);
    }
  } catch (err) {
    await invoke("open_card", { tab: "bag", notice: String(err) }).catch(
      () => {},
    );
  }
}

function handlePick(pick, x, y) {
  if (pick === "peek") {
    act("peek");
    return;
  }
  if (pick === "pet") {
    if (act("pet")) {
      invoke("stage_act", { kind: "pet", item: null }).catch(() => {});
    }
    return;
  }
  if (pick === "bowl") {
    handleBowlClick();
    return;
  }
  if (pick === "tunnel" || pick === "ball" || pick === "bed") {
    act(pick);
    return;
  }
  if (x != null && y != null && !occupied()) {
    const w = innerWidth,
      h = innerHeight;
    if (scene) {
      if (y / h >= scene.floor(x / w)) {
        life.go(x / w, y / h);
        play();
      }
    } else if (box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      const pt = inverse(box, x, y);
      life.go(pt.x, pt.y);
      play();
    }
  }
}

function copyFrame(targetCanvas, cropBox) {
  const w = innerWidth,
    h = innerHeight;
  const sx = world.width / w,
    sy = world.height / h;
  targetCanvas
    .getContext("2d", { alpha: false })
    .drawImage(
      world,
      cropBox.x * sx,
      cropBox.y * sy,
      cropBox.side * sx,
      cropBox.side * sy,
      0,
      0,
      targetCanvas.width,
      targetCanvas.height,
    );
}

function poseIn(cropBox) {
  const w = innerWidth,
    h = innerHeight;
  const { cx, base, size: side, z, p, age, action, face } = figure;
  const inFrame = (x, y) =>
    x >= cropBox.x &&
    x <= cropBox.x + cropBox.side &&
    y >= cropBox.y &&
    y <= cropBox.y + cropBox.side;
  const visible = (dx, dy) => {
    const x = cx + side * dx,
      y = base - side * dy;
    return inFrame(x, y) && hitsRabbit(x, y);
  };
  if (
    ![-0.42, -0.23, 0, 0.23, 0.42].some((x) =>
      [0.08, 0.2, 0.43, 0.66, 0.83].some((y) => visible(x, y)),
    )
  )
    return "scenery";
  const probe = (name) => {
    const at = puppet.landmark(name, face, p);
    return at && visible(at.x / 220, -at.y / 220);
  };
  const head =
    probe("head") ||
    [-0.22, 0, 0.22].some((x) => [0.46, 0.61, 0.72].some((y) => visible(x, y)));
  if (action === "tunnel" && face.view === "front" && !p.turn && p.inside > 0.55 && head)
    return "tunnel";
  if (action === "peek" && p.peek > 0.42 && head) {
    const behind =
      currentSceneId === "snow-forest" &&
      [0, 0.12, -0.12].some((x) =>
        [0.06, 0.18, 0.31].some((y) => {
          const a = cx + x * side,
            b = base - side * y;
          return inFrame(a, b) && scene?.occludes?.(a, b, z, "stump");
        }),
      );
    return behind ? "stump" : "peek";
  }
  if (action === "pet" && p.press > 0.32 && head) return "pet";
  if ((action === "eat" || action === "nibble") && age > 0.16 && age < 2.55 && head)
    return "chew";
  if (action === "loaf" && p.weight > 0.55 && head) {
    const lamp = scene?.props?.lamp;
    return currentSceneId === "snow-forest" &&
      figure.light === "night" &&
      lamp &&
      Math.hypot(cx / w - lamp[0], figure.ground / h - lamp[1]) < 0.23
      ? "nap"
      : "loaf";
  }
  if (p.weight > 0.6) {
    const [a, b, mix] = poseCels(face, p),
      cel = mix < 0.5 ? a : b;
    const dir = face.dir,
      sideHead = puppet.landmark("head", face, p)
        ? probe("head")
        : visible(0.38 * dir, 0.25) || visible(0.32 * dir, 0.44);
    if (["groom", "stand", "alert", "tilt"].includes(action) && head)
      return action;
    if (action === "sniff" && (sideHead || (face.view === "front" && head)))
      return "sniff";
    if (
      ["flop", "sploot", "stretch"].includes(action) &&
      sideHead &&
      probe("body") &&
      (action !== "stretch" || (cel === "stretchYawn" && p.yawn > 0.48)) &&
      (action !== "flop" || cel === "onFlank")
    )
      return action;
    if (action === "nudge" && sideHead && figure.ballInPlay) {
      const ball = things.find((o) => o.name === "ball");
      if (ball) {
        const { x, y } = ball.shape;
        if (
          inFrame(x, y) &&
          !scene?.occludes?.(x, y, ball.z) &&
          !things.some((o) => o.z > ball.z && propAt(x, y, o))
        )
          return "nudge";
      }
    }
  }
  if (action === "hop" && p.height > 0.043)
    return face.view === "side" ? "leap" : "hop";
  if (!p.turn && face.view === "back" && visible(0.01, 0.2)) return "back";
  return action === "listen" && head ? "listen" : "quiet";
}

function inviteIntoFrame(key) {
  if (!scene) return;
  const w = innerWidth,
    h = innerHeight;
  let best = { x: life.x, y: life.y, dir: life.face.dir },
    bestScore = -1;
  for (const [x, y] of [
    [life.x, life.y],
    [0.51, 0.81],
    [0.47, 0.89],
    [0.54, 0.72],
    [0.43, 0.78],
  ]) {
    const yy = clamp(y, scene.floor(x), 0.94);
    const side = scene.size(w, h, x, yy),
      dir = x > 0.52 ? -1 : 1;
    const lamp = scene.props?.lamp;
    if (
      key === "loaf" &&
      currentSceneId === "snow-forest" &&
      currentLight === "night" &&
      lamp &&
      Math.hypot(x - lamp[0], yy - lamp[1]) < 0.24
    )
      continue;
    let score = 0;
    for (const dx of [-0.48, -0.19, 0.15, 0.42]) {
      for (const dy of [0.1, 0.27, 0.51, 0.77]) {
        const px = x * w + dx * side,
          py = yy * h - dy * side;
        if (
          px > 1 &&
          px < w - 1 &&
          py > 1 &&
          py < h - 1 &&
          !scene.occludes?.(px, py, yy) &&
          !things.some((o) => o.z > yy && propAt(px, py, o))
        )
          score++;
      }
    }
    if (score > bestScore) {
      best = { x, y: yy, dir };
      bestScore = score;
    }
    if (score === 16) break;
  }
  const action = { key, dir: best.dir };
  if (Math.hypot(life.x - best.x, life.y - best.y) < 0.001) life.issue(action);
  else life.go(best.x, best.y, action);
}

function observeMoment(moment) {
  if (!figure || occupied()) return false;
  if (moment === "tunnel") return act("tunnel");
  if (moment === "stump") life.go(0.293, 0.823, "peek", "hop");
  else if (moment === "nap") life.go(0.66, 0.775, "loaf");
  else if (moment === "nudge") return act("ball");
  else if (moment === "leap") life.go(life.x > 0.5 ? 0.28 : 0.73, life.y);
  else {
    const key = {
      back: "back",
      pet: "pet",
      chew: "nibble",
      sniff: "sniff",
      stand: "stand",
      groom: "groom",
      loaf: "loaf",
      sploot: "sploot",
      stretch: "stretch",
      flop: "flop",
      alert: "alert",
      tilt: "tilt",
    }[moment];
    if (!key) return false;
    inviteIntoFrame(key);
  }
  play();
  return true;
}

const cameraSceneProxy = {
  copyFrame,
  subject() {
    if (!figure) return { x: 0.5, y: 0.55 };
    const w = innerWidth || 1,
      h = innerHeight || 1;
    const { p, face, cx, base, size: side } = figure;
    const head = puppet.landmark("head", face, p),
      torso = puppet.landmark("body", face, p);
    if (head && torso) {
      return {
        x: (cx + ((head.x + torso.x) * side) / 440) / w,
        y: (base + ((head.y + torso.y) * side) / 440) / h,
      };
    }
    const low = ["sploot", "flop", "stretch"].includes(p.action) ? p.weight : 0;
    const high = p.action === "stand" ? p.weight : 0;
    return {
      x: (cx + face.dir * side * (0.11 * p.noseDown + 0.05 * low)) / w,
      y: (base - side * (0.47 + 0.11 * high - 0.23 * low - 0.08 * p.noseDown)) / h,
    };
  },
  capture(cropBox) {
    if (!figure || draggingFood || !innerWidth || !innerHeight || !cropBox?.side)
      return null;
    const photo = document.createElement("canvas");
    photo.width = photo.height = 720;
    copyFrame(photo, cropBox);
    const now = new Date();
    return {
      photo,
      id: crypto.randomUUID(),
      captured: +now,
      offset: -now.getTimezoneOffset(),
      scene: currentSceneId === "snow-forest" ? "snow" : "paper",
      light: currentLight,
      pose: poseIn(cropBox),
      title: "",
    };
  },
};

const cameraLife = new AbortController();
const camera = createCamera(
  cameraHost,
  cameraLife.signal,
  () => cameraSceneProxy,
  (open) => {
    if (!open && view?.camera) {
      invoke("exit_stage_mode", { mode: "camera" }).catch(() => {});
    }
  },
  () => {
    invoke("exit_stage_mode", { mode: "camera" })
      .catch(() => {})
      .finally(() =>
        invoke("open_card", { tab: "album", notice: null }).catch(() => {}),
      );
  },
);

async function apply(v) {
  const prev = view;
  view = v;
  if (v.name) camera.setName(v.name);
  sel.hidden = !v.selecting;
  playBar.hidden = !(v.visible && v.playMode && !v.selecting && !v.camera);
  cameraHost.hidden = !(v.visible && v.camera);
  if (!v.camera && camera.isOpen()) camera.close();
  if (!v.visible || v.selecting) stop();

  const fullHabitat = v.settings.mode === "desktop" || v.camera;
  const targetScene = !fullHabitat
    ? "overlay"
    : v.camera && v.settings.scene === "clear"
      ? "paper"
      : v.settings.scene;
  const key =
    targetScene +
    ":" +
    v.revision +
    ":" +
    v.settings.mode +
    ":" +
    v.settings.patrol +
    ":" +
    v.display.work.w +
    "x" +
    v.display.work.h;

  if (key !== currentKey) {
    currentKey = key;
    const version = ++generation;
    scene?.dispose?.();
    scene = null;
    things = [];
    layers = [];
    world.hidden = true;
    size(world, 1, 1);

    if (!fullHabitat) {
      currentSceneId = "overlay";
      life.setPack(
        clearPack(
          v.settings.mode === "overlay" && v.settings.patrol === "taskbar",
        ),
      );
    } else if (!v.visible) {
      currentKey = "pending";
    } else {
      sceneLoading = (async () => {
        try {
          const next = await makeScene(targetScene, v);
          if (version !== generation) {
            next.dispose?.();
            return;
          }
          scene = next;
          currentSceneId = targetScene;
          ballX = rolling = lastPush = null;
          ballAngle = willowRestAngle;
          life.setPack(scene);
          scene.resize?.(innerWidth, innerHeight);
          layout();
          world.hidden = false;
        } catch (e) {
          document.body.dataset.sceneError = String(e);
          await invoke("report_scene", { message: String(e) }).catch(() => {});
        }
      })();
      await sceneLoading;
    }
  } else if (
    scene &&
    (prev?.atmosphere !== v.atmosphere ||
      JSON.stringify(prev?.placed) !== JSON.stringify(v.placed))
  ) {
    layout();
  }

  if (view?.visible && !view.selecting) {
    lastShape = "";
    play();
  }
}

function tick(t) {
  frame = 0;
  if (!view?.visible || view.selecting) return;
  const wait = life.state.kind === "idle" ? 65 : 32;
  if (!previous || t - previous >= wait) {
    if (
      (view.playMode || draggingFood) &&
      above &&
      life.clock - aboveAt >= 0.22 &&
      ["idle", "listen", "tilt", "sniff", "groom", "loaf"].includes(
        life.state.kind,
      ) &&
      !life.pending &&
      !occupied()
    ) {
      above = false;
      hoverAt = life.clock;
      act("stand");
    }
    life.update(previous ? Math.min((t - previous) / 1000, 0.12) : 0);
    previous = t;
    draw(t);
  }
  play();
}

function draw(t) {
  const w = innerWidth,
    h = innerHeight;
  if (!w || !h) return;
  const ratio = devicePixelRatio || 1;
  box = field(view, w, h, ratio);

  if (scene) {
    const nextLightKey =
      (view.atmosphere || "auto") + ":" + daylight(view.atmosphere || "auto");
    if (nextLightKey !== lastLightKey) layout();
  }

  const p = life.pose();
  let x, ground, side;
  if (scene) {
    x = life.x * w;
    ground = life.y * h;
    side = scene.size(w, h, life.x, life.y);
  } else {
    const xy = location(box, life.x, life.y);
    x = xy.x;
    ground = xy.ground;
    side = box.size;
  }

  const log = scene ? things.find((o) => o.name === "tunnel") : null;
  let z = life.y;
  ({ x, ground, size: side, z } = tunnelPlacement(log, x, ground, side, z, p));
  if (p.foreSlip) {
    const span = scene
      ? w
      : location(box, 1, life.y).x - location(box, 0, life.y).x;
    p.brace = (Math.abs(p.foreSlip) * span * 220) / side;
  }
  if (scene) advanceBall(p, w, h);

  const base = ground - side * p.height;
  const tip = puppet.landmark("nose", life.face, p);
  const mx = tip
    ? x + (tip.x * side) / 220
    : x + side * (life.face.view === "side" ? life.face.dir * 0.48 : -0.082);
  const my = tip
    ? base + (tip.y * side) / 220
    : base - side * (life.face.view === "side" ? 0.49 : 0.455);

  figure = {
    cx: x,
    ground,
    base,
    size: side,
    face: life.face,
    p,
    z,
    mx,
    my,
    action: life.state.kind,
    ballInPlay: lastPush === life.state,
    age: life.state.age,
    light: currentLight,
  };

  const extent = Math.ceil(side * 1.7);
  const ox = Math.round(x - extent * 0.5),
    oy = Math.round(ground - extent * 0.81);
  const sr = Math.min(ratio, 1.5),
    localX = x - ox,
    localY = ground - oy;

  size(stamp, extent * sr, extent * sr);
  actor.setTransform(stamp.width / extent, 0, 0, stamp.height / extent, 0, 0);
  actor.clearRect(0, 0, extent, extent);
  if (puppet.blendScale !== (side < 135 ? 0.5 : 1.25))
    puppet.setCompact(side < 135);

  if (scene && wash?.night) {
    paintNightFigure ??= nightFigure();
    paintNightFigure(
      actor,
      {
        x: wash.lamp.x - ox,
        y: wash.lamp.y - oy,
        radius: wash.lamp.radius,
      },
      puppet,
      localX,
      localY,
      side,
      life.face,
      p,
    );
  } else {
    puppet.draw(actor, localX, localY, side, life.face, p, p.turn);
  }

  const c = scene ? terrain : ink;
  if (scene) {
    size(world, w * sr, h * sr);
    world.style.width = w + "px";
    world.style.height = h + "px";
    terrain.setTransform(world.width / w, 0, 0, world.height / h, 0, 0);
    terrain.clearRect(0, 0, w, h);
    if (!scene.transparent) {
      if (scene.background) scene.background(terrain, w, h, life.clock);
      else {
        terrain.fillStyle = paperPattern;
        terrain.fillRect(0, 0, w, h);
        if (paperGlow) {
          terrain.fillStyle = paperGlow;
          terrain.fillRect(0, 0, w, h);
        }
      }
      if (wash?.night) wash.paint();
    }
    if (log)
      terrain.drawImage(
        wash?.night ? nightPrint(sprites.back) : sprites.back,
        log.x,
        log.y,
        log.w,
        log.h,
      );
    for (const o of layers) if (o.z <= z) groundThing(terrain, o);
    pet.hidden = true;
  } else {
    pet.hidden = false;
    size(pet, stamp.width, stamp.height);
    pet.style.width = pet.style.height = extent + "px";
    pet.style.transform = "translate(" + ox + "px," + oy + "px)";
    ink.setTransform(pet.width / extent, 0, 0, pet.height / extent, 0, 0);
    ink.clearRect(0, 0, extent, extent);
    ink.translate(-ox, -oy);
  }

  c.save();
  c.translate(x, ground - 1);
  c.scale(side * (0.36 - 0.7 * p.height), side * 0.044);
  const shade = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, "rgba(78,55,40," + Math.max(0, 0.24 - p.height) + ")");
  shade.addColorStop(1, "rgba(78,55,40,0)");
  c.fillStyle = shade;
  c.fillRect(-1, -1, 2, 2);
  c.restore();

  c.drawImage(stamp, ox, oy, extent, extent);

  if (p.heart > 0.01) {
    c.save();
    c.globalAlpha = p.heart;
    c.fillStyle = "#d78583";
    c.font = Math.ceil(side * 0.145) + "px Georgia";
    c.fillText(
      "♥",
      x + side * 0.2,
      ground - side * (0.86 + 0.15 * p.heartY),
    );
    c.restore();
  }
  if (["eat", "nibble"].includes(life.state.kind)) {
    paintIcon(
      c,
      icons,
      life.state.kind === "nibble" ? "hay" : food,
      mx,
      my + side * 0.022,
      side * 0.17 * Math.max(0.18, 1 - life.state.age / 2.8),
    );
  }
  if (scene) {
    for (const o of layers) if (o.z > z) groundThing(terrain, o);
    scene.after?.(terrain, w, h, life.clock);
    if (!scene.transparent && !wash?.night) wash?.paint();
    else if (scene.transparent && wash?.night) {
      const lamp = things.find((o) => o.name === "lamp");
      if (lamp) {
        terrain.save();
        const lx = lamp.x + lamp.w * 0.5,
          ly = lamp.y + lamp.h * 0.45;
        const glow = terrain.createRadialGradient(lx, ly, 0, lx, ly, lamp.w * 1.4);
        glow.addColorStop(0, "rgba(255,205,122,.28)");
        glow.addColorStop(1, "rgba(255,205,122,0)");
        terrain.fillStyle = glow;
        terrain.beginPath();
        terrain.arc(lx, ly, lamp.w * 1.4, 0, Math.PI * 2);
        terrain.fill();
        terrain.restore();
      }
    }
  }
  if (draggingFood && life.face.view !== "back") {
    c.save();
    c.strokeStyle = "#ad7853";
    c.lineWidth = 1.5;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.arc(mx, my, Math.max(15, side * 0.14), 0, 2 * Math.PI);
    c.stroke();
    c.restore();
  }

  if (view.camera && camera.isOpen()) camera.update();

  if (
    !view.playMode &&
    !view.camera &&
    !view.selecting &&
    !sending &&
    t - lastHit >= 45
  ) {
    lastHit = t;
    let hit;
    if (!scene) {
      const n = Math.max(48, Math.min(184, Math.round(extent * ratio)));
      size(mask, n, n);
      hitCtx.setTransform(1, 0, 0, 1, 0, 0);
      hitCtx.clearRect(0, 0, n, n);
      hitCtx.drawImage(stamp, 0, 0, n, n);
      const region = alphaRuns(
        hitCtx.getImageData(0, 0, n, n).data,
        n,
        extent,
        extent,
        ratio,
        null,
      );
      hit = { x: Math.round(ox * ratio), y: Math.round(oy * ratio), ...region };
    } else {
      let minX = ox,
        minY = oy,
        maxX = ox + extent,
        maxY = oy + extent;
      const interactiveProps = things.filter((o) => o.name !== "lamp");
      for (const o of interactiveProps) {
        minX = Math.min(minX, o.x);
        minY = Math.min(minY, o.y);
        maxX = Math.max(maxX, o.x + o.w);
        maxY = Math.max(maxY, o.y + o.h);
      }
      minX = clamp(Math.floor(minX), 0, w);
      minY = clamp(Math.floor(minY), 0, h);
      maxX = clamp(Math.ceil(maxX), minX + 1, w);
      maxY = clamp(Math.ceil(maxY), minY + 1, h);
      const bw = Math.min(maxX - minX, Math.floor(4096 / ratio));
      const bh = Math.min(maxY - minY, Math.floor(4096 / ratio));
      const cols = Math.min(360, Math.max(64, Math.ceil((bw * ratio) / 4)));
      const rowsN = Math.min(220, Math.max(48, Math.ceil((bh * ratio) / 4)));
      size(mask, cols, rowsN);
      hitCtx.setTransform(1, 0, 0, 1, 0, 0);
      hitCtx.clearRect(0, 0, cols, rowsN);
      hitCtx.setTransform(
        cols / bw,
        0,
        0,
        rowsN / bh,
        (-minX * cols) / bw,
        (-minY * rowsN) / bh,
      );
      hitCtx.drawImage(stamp, ox, oy, extent, extent);
      hitCtx.save();
      hitCtx.globalCompositeOperation = "destination-out";
      for (const o of scene.landmarks?.() || []) {
        if (o.z > z) scene.paintLandmark(hitCtx, o);
      }
      hitCtx.restore();
      if (log) hitCtx.drawImage(sprites.back, log.x, log.y, log.w, log.h);
      for (const o of interactiveProps) {
        if (o.name === "ball") paintWillow(hitCtx, icons, o.shape);
        else if (o.name === "bed")
          paintIcon(hitCtx, icons, "bed", o.x + o.w / 2, o.y + o.h / 2, o.w);
        else {
          const tile = sprites[o.name];
          if (tile) hitCtx.drawImage(tile, o.x, o.y, o.w, o.h);
        }
      }
      const region = alphaRunsBox(
        hitCtx.getImageData(0, 0, cols, rowsN).data,
        cols,
        rowsN,
        bw,
        bh,
        ratio,
      );
      hit = { x: Math.round(minX * ratio), y: Math.round(minY * ratio), ...region };
    }
    const sig = JSON.stringify(hit);
    if (sig !== lastShape) {
      sending = true;
      lastShape = sig;
      invoke("update_hit", { hit })
        .catch(() => {
          lastShape = "";
        })
        .finally(() => (sending = false));
    }
  }
}

window.addEventListener("resize", () => {
  scene?.resize?.(innerWidth, innerHeight);
  layout();
  lastShape = "";
  play();
});

await listen("desktop-view", (e) => apply(e.payload));

await listen("gesture", ({ payload: key }) => {
  if (key === "drop") {
    life.held = false;
    dragOffset = null;
    dragActive = false;
    life.wait = 3;
  } else {
    const eat = key === "carrot" || key === "hay";
    if (eat) {
      food = key;
      preferredFood = key;
    }
    life.issue({ key: eat ? "eat" : key });
  }
  play();
});

await listen("stage-click", ({ payload: [px, py] }) => {
  const ratio = devicePixelRatio || 1;
  const cx = px / ratio,
    cy = py / ratio;
  const pick = target(cx, cy);
  if (pick) handlePick(pick, cx, cy);
});

await listen("drag-start", ({ payload: [px, py] }) => {
  const ratio = devicePixelRatio || 1;
  const cx = px / ratio,
    cy = py / ratio;
  dragActive = hitsRabbit(cx, cy);
  dragOffset = null;
});

await listen("drag-pet", ({ payload: [x, y] }) => {
  if (!box || !dragActive) return;
  const px = x / devicePixelRatio,
    py = y / devicePixelRatio;
  if (!dragOffset) {
    const at = scene
      ? { x: life.x * innerWidth, ground: life.y * innerHeight }
      : location(box, life.x, life.y);
    dragOffset = [at.x - px, at.ground - py];
    life.stay();
    life.held = true;
  }
  const nx = px + dragOffset[0],
    ny = py + dragOffset[1];
  const pt = scene
    ? {
        x: clamp(nx / innerWidth, 0.05, 0.95),
        y: clamp(
          ny / innerHeight,
          scene.floor(nx / innerWidth),
          currentSceneId === "snow-forest" ? 0.95 : Math.min(0.95, workMetrics(view, innerWidth, innerHeight).wy + workMetrics(view, innerWidth, innerHeight).wh - 0.01),
        ),
      }
    : inverse(box, nx, ny);
  life.x = pt.x;
  life.y = pt.y;
  play();
});

await listen("food-drag", async ({ payload }) => {
  const ratio = devicePixelRatio || 1;
  const cx = payload.x / ratio,
    cy = payload.y / ratio;
  if (payload.phase === "start" || payload.phase === "move") {
    if (!draggingFood) {
      draggingFood = true;
      above = false;
      life.held = true;
      life.issue({ key: "front" });
    }
    const cell = iconMap[payload.item];
    foodGhost.style.backgroundPosition =
      (cell % 3) * 50 + "% " + Math.floor(cell / 3) * 50 + "%";
    foodGhost.style.left = cx + "px";
    foodGhost.style.top = cy + "px";
    foodGhost.hidden = false;
    watchAbove(cx, cy);
    play();
    return;
  }
  draggingFood = false;
  foodGhost.hidden = true;
  above = false;
  life.held = false;
  if (payload.phase === "end" && payload.item && canFeed(cx, cy)) {
    const atBowl = propAt(
      cx,
      cy,
      things.find((o) => o.name === "bowl"),
    );
    try {
      const reply = await invoke("stage_act", {
        kind: "feed",
        item: payload.item,
      });
      if (reply?.fed) {
        preferredFood = reply.fed;
        act("eat", reply.fed, atBowl);
      }
    } catch (err) {
      await invoke("open_card", { tab: "bag", notice: String(err) }).catch(
        () => {},
      );
    }
  } else {
    life.wait = 2;
    play();
  }
});

await listen("camera-open", async ({ payload }) => {
  await sceneLoading;
  if (!view?.visible || !view.camera) return;
  draw(performance.now());
  if (payload?.moment) observeMoment(payload.moment);
  camera.start(true);
  play();
});

// Interactive play mode handlers (only active when view.playMode is true)
document.querySelector("#exit-play").onclick = () =>
  invoke("exit_stage_mode", { mode: "play" }).catch(() => {});

document.addEventListener("pointerdown", (e) => {
  if (!view?.playMode || view.selecting || view.camera) return;
  if (playBar.contains(e.target) || !e.isPrimary || e.button !== 0) return;
  if (!hitsRabbit(e.clientX, e.clientY) || occupied()) return;
  const at = scene
    ? { x: life.x * innerWidth, ground: life.y * innerHeight }
    : location(box, life.x, life.y);
  playCarry = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    dx: at.x - e.clientX,
    dy: at.ground - e.clientY,
    active: false,
  };
});

window.addEventListener("pointermove", (e) => {
  if (playCarry && e.pointerId === playCarry.id) {
    if (!playCarry.active) {
      if (
        Math.hypot(e.clientX - playCarry.startX, e.clientY - playCarry.startY) <= 6
      )
        return;
      playCarry.active = true;
      suppressPlayClick = true;
      above = false;
      life.stay();
      life.held = true;
    }
    const nx = e.clientX + playCarry.dx,
      ny = e.clientY + playCarry.dy;
    const pt = scene
      ? {
          x: clamp(nx / innerWidth, 0.05, 0.95),
          y: clamp(ny / innerHeight, scene.floor(nx / innerWidth), 0.95),
        }
      : inverse(box, nx, ny);
    life.x = pt.x;
    life.y = pt.y;
    play();
    return;
  }
  if (
    !view?.playMode ||
    view.selecting ||
    view.camera ||
    e.pointerType !== "mouse" ||
    !figure
  )
    return;
  const x = e.clientX,
    y = e.clientY;
  document.body.style.cursor = target(x, y) ? "pointer" : "default";
  if (!reduced.matches && !e.buttons && !occupied()) {
    const prev = lastPointer,
      now = e.timeStamp;
    const speed = prev
      ? Math.hypot(x - prev.x, y - prev.y) / Math.max(8, now - prev.now)
      : 0;
    if (
      prev &&
      now - prev.now < 150 &&
      speed > 0.9 &&
      Math.hypot(x - figure.cx, y - (figure.base - figure.size * 0.63)) <
        figure.size * 0.77 &&
      life.state.kind === "idle" &&
      life.clock - hoverAt > 2
    ) {
      hoverAt = life.clock;
      above = false;
      act("alert");
    } else watchAbove(x, y);
    lastPointer = { x, y, now };
  }
});

function endPlayCarry(e) {
  if (!playCarry || e.pointerId !== playCarry.id) return;
  const active = playCarry.active;
  playCarry = null;
  if (!active) return;
  life.held = false;
  life.wait = 3;
  play();
  requestAnimationFrame(() => {
    suppressPlayClick = false;
  });
}
window.addEventListener("pointerup", endPlayCarry);
window.addEventListener("pointercancel", endPlayCarry);

document.addEventListener("click", (e) => {
  if (!view?.playMode || view.selecting || view.camera) return;
  if (playBar.contains(e.target)) return;
  if (suppressPlayClick) {
    suppressPlayClick = false;
    return;
  }
  if (e.detail > 1) return;
  handlePick(target(e.clientX, e.clientY), e.clientX, e.clientY);
});

document.addEventListener("dblclick", (e) => {
  if (!view?.playMode || view.selecting || view.camera) return;
  if (playBar.contains(e.target)) return;
  if (target(e.clientX, e.clientY))
    invoke("open_card", { tab: null, notice: null }).catch(() => {});
});

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (view?.playMode && !view.selecting && !view.camera) {
    invoke("open_card", { tab: null, notice: null }).catch(() => {});
  }
});

// Selection fence handlers
let corner = null;
const marker = sel.querySelector("i");
function finish(fence) {
  corner = null;
  marker.style.display = "none";
  invoke("finish_fence", { fence }).catch((e) => {
    sel.querySelector("span").textContent = String(e);
  });
}
sel.querySelector("button").onclick = () => finish(null);
sel.onpointerdown = (e) => {
  if (e.target.tagName === "BUTTON") return;
  corner = [e.clientX, e.clientY];
  sel.setPointerCapture(e.pointerId);
};
function rectangle(e) {
  const x = Math.min(corner[0], e.clientX),
    y = Math.min(corner[1], e.clientY);
  return {
    x,
    y,
    w: Math.abs(e.clientX - corner[0]),
    h: Math.abs(e.clientY - corner[1]),
  };
}
sel.onpointermove = (e) => {
  if (!corner) return;
  const r = rectangle(e);
  Object.assign(marker.style, {
    display: "block",
    left: r.x + "px",
    top: r.y + "px",
    width: r.w + "px",
    height: r.h + "px",
  });
};
sel.onpointerup = (e) => {
  if (!corner) return;
  const r = rectangle(e);
  finish({
    x: r.x / innerWidth,
    y: r.y / innerHeight,
    w: r.w / innerWidth,
    h: r.h / innerHeight,
  });
};
sel.onpointercancel = () => finish(null);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!sel.hidden) {
      finish(null);
      return;
    }
    if (view?.camera) {
      camera.close();
      return;
    }
    if (view?.playMode) {
      invoke("exit_stage_mode", { mode: "play" }).catch(() => {});
      return;
    }
  }
  if (
    view?.camera &&
    !e.defaultPrevented &&
    !e.isComposing &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === "c" &&
    !e.target.closest("input:not([type=range]),textarea,select,[contenteditable=true]")
  ) {
    e.preventDefault();
    camera.close();
    return;
  }
  if (view?.playMode && !view.selecting && !view.camera) {
    const offsets = {
      ArrowLeft: [-0.15, 0],
      ArrowRight: [0.15, 0],
      ArrowUp: [0, -0.14],
      ArrowDown: [0, 0.14],
    };
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handlePick("pet");
    } else if (offsets[e.key] && !occupied()) {
      e.preventDefault();
      const [dx, dy] = offsets[e.key];
      if (scene) {
        const nx = clamp(life.x + dx, 0.07, 0.93);
        const ny = clamp(life.y + dy, scene.floor(nx), 0.94);
        life.go(nx, ny);
      } else {
        life.go(clamp(life.x + dx, 0.05, 0.95), clamp(life.y + dy, 0.1, 0.95));
      }
      play();
    }
  }
});

await apply(await invoke("desktop_view"));
