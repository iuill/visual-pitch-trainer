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
  return {
    background: style.getPropertyValue("--graph-background").trim(),
    grid: style.getPropertyValue("--graph-grid").trim(),
    octave: style.getPropertyValue("--graph-octave").trim(),
    label: style.getPropertyValue("--muted").trim(),
    target: style.getPropertyValue("--accent").trim(),
    voice: style.getPropertyValue("--blue").trim(),
  };
}

// The static app uses one palette for every graph, including PNG exports.
let theme: ReturnType<typeof readGraphTheme> | undefined;

export function getGraphTheme() {
  theme ??= readGraphTheme();
  return theme;
}
