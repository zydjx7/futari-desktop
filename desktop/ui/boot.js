const entry = document.querySelector("script[data-entry]").dataset.entry;
// The native Mac overlay uses real alpha even when a signed 0.2.8 UI paints a green matte.
if (/Mac/.test(navigator.platform) && (entry === "stage" || entry === "furnishings")) {
  document.documentElement.style.setProperty("background-color", "transparent", "important");
}
const invoke = window.__TAURI__.core.invoke;
async function load(base) {
  await Promise.all(
    ["vendor/room.css", "vendor/album.css", entry + ".css"].map(
      (path) =>
        new Promise((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.onload = resolve;
          link.onerror = reject;
          link.href = new URL(path, base).href;
          document.head.append(link);
        }),
    ),
  );
  await import(new URL(entry + ".js", base).href);
}
const info = await invoke("ui_bundle_info");
try {
  await load(info.active ? info.origin + "/" : import.meta.url);
  // Older signed notebooks already handle the check action but hide it in local mode.
  if (info.active && entry === "card") {
    const page = document.querySelector("#page");
    function restoreLocalCheck() {
      if (!page.querySelector('[data-action="local"]') || page.querySelector('[data-action="check-update"]')) return;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "check-update";
      button.textContent = "检查更新";
      page.append(button);
    }
    new MutationObserver(restoreLocalCheck).observe(page, { childList: true });
    restoreLocalCheck();
  }
} catch (error) {
  if (!info.active) throw error;
  await invoke("ui_bundle_rollback", { version: info.active });
}
