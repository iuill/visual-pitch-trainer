import { getGraphTheme, resizeGraphCanvas } from "./graphCanvas";
import {
  createVoiceRangeGraphLayout,
  type VoiceRangeGraphSample,
} from "./graphModel";
import {
  midiToKaraokeName,
  midiToNoteName,
  midiToSolfegeWithOctave,
} from "./pitchMath";

export type VoiceRangeGraphNotation = "scientific" | "solfege" | "karaoke";

export function drawVoiceRangeGraph(
  canvas: HTMLCanvasElement,
  samples: VoiceRangeGraphSample[],
  notes: number[],
  notation: VoiceRangeGraphNotation,
) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const backing = resizeGraphCanvas(canvas, width, height);
  context.setTransform(backing.pixelRatio, 0, 0, backing.pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = getGraphTheme().background;
  context.fillRect(0, 0, width, height);
  const layout = createVoiceRangeGraphLayout(samples, notes, width, height);
  const { padding, plotWidth, plotHeight, x, y } = layout;
  const format =
    notation === "solfege"
      ? midiToSolfegeWithOctave
      : notation === "karaoke"
        ? midiToKaraokeName
        : midiToNoteName;
  context.font = '11px "Noto Sans JP", sans-serif';
  const step = layout.maxMidi - layout.minMidi > 36 ? 6 : 3;
  context.textAlign = "right";
  for (
    let midi = Math.ceil(layout.minMidi / step) * step;
    midi <= layout.maxMidi;
    midi += step
  ) {
    context.strokeStyle = getGraphTheme().grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, y(midi));
    context.lineTo(width - padding.right, y(midi));
    context.stroke();
    context.fillStyle = getGraphTheme().label;
    context.fillText(format(midi), padding.left - 8, y(midi) + 4);
  }
  context.textAlign = "center";
  for (let seconds = -12; seconds <= 0; seconds += 3) {
    const at = x(layout.end + seconds * 1000);
    context.fillStyle = getGraphTheme().label;
    context.fillText(seconds === 0 ? "0秒" : `${seconds}秒`, at, height - 10);
  }
  context.save();
  context.beginPath();
  context.rect(padding.left, padding.top, plotWidth, plotHeight);
  context.clip();
  context.strokeStyle = getGraphTheme().voice;
  context.lineWidth = 2.5;
  context.beginPath();
  let previous: VoiceRangeGraphSample | null = null;
  for (const sample of layout.visible) {
    if (sample.midi === null) {
      previous = null;
      continue;
    }
    if (!previous || sample.timeMs - previous.timeMs > 250)
      context.moveTo(x(sample.timeMs), y(sample.midi));
    else context.lineTo(x(sample.timeMs), y(sample.midi));
    previous = sample;
  }
  context.stroke();
  const last = layout.visible.at(-1);
  if (last?.midi !== null && last?.midi !== undefined) {
    context.fillStyle = getGraphTheme().voice;
    context.beginPath();
    context.arc(x(last.timeMs), y(last.midi), 4, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  const low = notes[0],
    high = notes.at(-1);
  if (low !== undefined && high !== undefined) {
    for (const [midi, label, color] of low === high
      ? ([[low, "記録", getGraphTheme().target]] as const)
      : ([
          [low, "最低", getGraphTheme().target],
          [high, "最高", "#875a12"],
        ] as const)) {
      context.setLineDash([6, 4]);
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(padding.left, y(midi));
      context.lineTo(width - padding.right, y(midi));
      context.stroke();
      context.setLineDash([]);
      const text = `${label} ${format(midi)}`;
      const labelWidth = context.measureText(text).width + 10;
      context.fillStyle = "#fff";
      context.fillRect(
        width - padding.right - labelWidth,
        y(midi) - 19,
        labelWidth,
        17,
      );
      context.fillStyle = color;
      context.textAlign = "right";
      context.fillText(text, width - padding.right - 4, y(midi) - 6);
    }
  }
}
