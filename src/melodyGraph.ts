import {
  createMelodyGraphLayout,
  resolveCanvasBackingSize,
} from "./graphModel";
import { formatPitchMovement, midiToNoteName, type Note } from "./pitchMath";

export type MelodyTraceSample = { time: number; midi: number | null };
export type MelodyGraphData = {
  notes: Note[];
  seconds: number;
  tolerance: number;
  phase: "ready" | "listen" | "countdown" | "sing" | "finished" | "stopped";
  cursor: number;
  samples: MelodyTraceSample[];
};

export function drawMelodyGraph(
  canvas: HTMLCanvasElement,
  scroll: HTMLElement,
  data: MelodyGraphData,
  follow: boolean,
) {
  if (!data.notes.length || !scroll.clientWidth) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const layout = createMelodyGraphLayout(
    data.notes.map((note) => note.frequency),
    data.seconds,
    Math.max(scroll.clientWidth, data.notes.length * 112 + 70),
    300,
  );
  const backing = resolveCanvasBackingSize(
    layout.width,
    layout.height,
    window.devicePixelRatio,
  );
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  if (canvas.width !== backing.width) canvas.width = backing.width;
  if (canvas.height !== backing.height) canvas.height = backing.height;
  context.setTransform(backing.pixelRatio, 0, 0, backing.pixelRatio, 0, 0);
  context.clearRect(0, 0, layout.width, layout.height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, layout.width, layout.height);
  context.font = "12px system-ui, sans-serif";
  const playing = data.phase === "listen" || data.phase === "sing";
  const currentIndex = Math.min(
    data.notes.length - 1,
    Math.floor(data.cursor / data.seconds),
  );
  const nextIndex = data.phase === "finished" ? -1 : currentIndex + 1;
  for (let midi = layout.minMidi; midi <= layout.maxMidi; midi++) {
    const y = layout.y(midi);
    context.strokeStyle = "#e1e8eb";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(layout.padding.left, y);
    context.lineTo(layout.width - layout.padding.right, y);
    context.stroke();
    if (midi % 2 === 0 || midi === layout.minMidi || midi === layout.maxMidi) {
      context.fillStyle = "#5c6870";
      context.fillText(midiToNoteName(midi), 5, y + 4);
    }
  }
  // Keep the route behind the bars and the voice trace.
  for (let index = 1; index < data.notes.length; index++) {
    const boundary = layout.x(index * data.seconds);
    const fromY = layout.y(layout.midis[index - 1]);
    const toY = layout.y(layout.midis[index]);
    const upcoming = index === nextIndex;
    context.strokeStyle = upcoming ? "#b5790b" : "#9aafb7";
    context.lineWidth = upcoming ? 2.5 : 1.5;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(boundary - 18, fromY);
    context.lineTo(boundary + 18, toY);
    context.stroke();
    context.setLineDash([]);
  }
  data.notes.forEach((note, index) => {
    const start = index * data.seconds;
    const x = layout.x(start) + 2;
    const width = layout.plotWidth / data.notes.length - 4;
    const midi = layout.midis[index];
    const y = layout.y(midi);
    const visited = data.cursor >= (index + 1) * data.seconds;
    const active = playing && index === currentIndex;
    const top = layout.y(midi + data.tolerance / 100);
    const bottom = layout.y(midi - data.tolerance / 100);
    context.fillStyle = visited
      ? "rgba(20,108,117,0.15)"
      : "rgba(20,108,117,0.07)";
    context.fillRect(x, top, width, Math.max(4, bottom - top));
    if (active) {
      context.fillStyle = "rgba(20,108,117,0.15)";
      context.fillRect(x, top - 5, width, Math.max(14, bottom - top + 10));
      context.fillStyle = "#35c2b3";
      const progress = Math.max(
        0,
        Math.min(1, (data.cursor - start) / data.seconds),
      );
      context.fillRect(x, bottom + 5, width * progress, 3);
    }
    context.strokeStyle = active ? "#0d4f56" : "#4a858a";
    context.lineWidth = active ? 5 : 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width, y);
    context.stroke();
    context.fillStyle = "#164f55";
    context.textAlign = "center";
    context.font = active
      ? "700 12px system-ui, sans-serif"
      : "12px system-ui, sans-serif";
    context.fillText(note.solfege, x + width / 2, y + 23);
    if (index > 0) {
      const upcoming = index === nextIndex;
      const label = formatPitchMovement(
        data.notes[index - 1].frequency,
        note.frequency,
        true,
      );
      context.font = `${upcoming ? "800" : "600"} 13px system-ui, sans-serif`;
      const badgeWidth = context.measureText(label).width + 18;
      const badgeX = x + (width - badgeWidth) / 2;
      const badgeY = Math.max(5, y - 40);
      context.fillStyle = upcoming ? "#f7d774" : "#edf3f5";
      context.strokeStyle = upcoming ? "#b5790b" : "#b5c7ce";
      context.lineWidth = upcoming ? 2 : 1;
      context.beginPath();
      context.roundRect(badgeX, badgeY, badgeWidth, 25, 8);
      context.fill();
      context.stroke();
      context.fillStyle = "#26313c";
      context.fillText(label, x + width / 2, badgeY + 17);
    }
    context.fillStyle = "#5c6870";
    context.fillText(String(index + 1), x + width / 2, layout.height - 12);
  });
  context.textAlign = "left";
  context.save();
  context.beginPath();
  context.rect(
    layout.padding.left,
    layout.padding.top,
    layout.plotWidth,
    layout.plotHeight,
  );
  context.clip();
  context.strokeStyle = "#2b6cb0";
  context.lineWidth = 2.5;
  context.beginPath();
  let previous: MelodyTraceSample | null = null;
  for (const sample of data.samples) {
    if (sample.midi === null) {
      previous = null;
      continue;
    }
    const x = layout.x(sample.time),
      y = layout.y(sample.midi);
    if (!previous || sample.time - previous.time > 0.25) context.moveTo(x, y);
    else context.lineTo(x, y);
    previous = sample;
  }
  context.stroke();
  context.restore();
  if (data.phase !== "ready") {
    const x = layout.x(data.cursor);
    context.strokeStyle = "#172026";
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(x, layout.padding.top);
    context.lineTo(x, layout.height - layout.padding.bottom);
    context.stroke();
    context.setLineDash([]);
    const guideRight =
      layout.x(Math.min(data.notes.length, currentIndex + 1.5) * data.seconds) +
      56;
    if (
      follow &&
      (guideRight > scroll.scrollLeft + scroll.clientWidth ||
        x < scroll.scrollLeft + 55)
    ) {
      scroll.scrollLeft = Math.max(
        0,
        layout.x(currentIndex * data.seconds) - 60,
      );
    }
  }
}
