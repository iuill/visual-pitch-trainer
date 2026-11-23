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
    grid: color("--graph-grid", "#dce5e8"),
    octave: color("--graph-octave", "#c6d4d8"),
    label: color("--muted", "#5c6870"),
    target: color("--accent", "#146c75"),
    voice: color("--blue", "#2b6cb0"),
    trend: color("--graph-trend", "#1f5f93"),
  };
}

// The static app uses one palette for every graph, including PNG exports.
let theme: ReturnType<typeof readGraphTheme> | undefined;

export function getGraphTheme() {
  theme ??= readGraphTheme();
  return theme;
}
