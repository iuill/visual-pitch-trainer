import { resolveCanvasBackingSize } from "./graphModel";

export function resizeGraphCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const size = resolveCanvasBackingSize(width, height, window.devicePixelRatio);
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  return size;
}

export function observeGraphResize(elements: Element[], redraw: () => void) {
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(redraw);
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", redraw);
  return () => window.removeEventListener("resize", redraw);
}

function readGraphTheme() {
  const style = getComputedStyle(document.documentElement);
  const color = (property: string, fallback: string) =>
    style.getPropertyValue(property).trim() || fallback;
  return {
    background: color("--graph-background", "#fbfcfc"),
    panel: color("--panel", "#ffffff"),
    text: color("--text", "#172026"),
    border: color("--line", "#d7dee2"),
    grid: color("--graph-grid", "#dce5e8"),
    octave: color("--graph-octave", "#c6d4d8"),
    label: color("--muted", "#5c6870"),
    target: color("--accent", "#146c75"),
    targetStrong: color("--accent-strong", "#0d4f56"),
    inTune: color("--ok", "#2f855a"),
    voice: color("--blue", "#2b6cb0"),
    trend: color("--graph-trend", "#1f5f93"),
    highlight: color("--highlight", "#f7d774"),
    gameSuccess: color("--game-success", "#15806d"),
    comboTiers: [
      color("--combo-tier-1", "#15857d"),
      color("--combo-tier-2", "#2f9e44"),
      color("--combo-tier-3", "#e09f10"),
      color("--combo-tier-4", "#e8590c"),
    ],
  };
}

// The static app uses one palette for every graph, including PNG exports.
let theme: ReturnType<typeof readGraphTheme> | undefined;

export function getGraphTheme() {
  theme ??= readGraphTheme();
  return theme;
}
