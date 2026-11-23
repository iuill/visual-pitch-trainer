import {
  type GameEffectState,
  getComboTier,
  getComboTierProgress,
  getTargetGlowStrength,
} from "./gameEffects";
import { getGraphTheme, resizeGraphCanvas } from "./graphCanvas";
import {
  buildGraphPoints,
  clamp,
  createGraphViewport,
  type GraphPadding,
  midiToY,
} from "./graphModel";
import { midiToNoteName, midiToSolfegeName, type Note } from "./pitchMath";
import type { PitchSample } from "./session";

export const GRAPH_SECONDS = 12;
const GRAPH_RANGE_SEMITONES = 6;
export const LANDING_RIPPLE_DURATION_MS = 850;
export const COMBO_MILESTONE_DURATION_MS = 1600;
const EFFECT_COLORS = {
  meterLabel: "#41505a",
  // Keep RGB channels so each gradient stop can have its own opacity.
  glowGreenRgb: "28, 148, 119",
  glowGoldRgb: "247, 201, 72",
};

export function drawSinglePracticeGraph(
  canvas: HTMLCanvasElement,
  options: {
    target: Note;
    tolerance: number;
    samples: PitchSample[];
    effects: GameEffectState;
  },
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  const size = resizeGraphCanvas(
    canvas,
    Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width)),
    Math.max(
      1,
      Math.round(rect.height || canvas.clientHeight || canvas.height),
    ),
  );
  const { pixelRatio } = size;
  const width = size.width / pixelRatio;
  const height = size.height / pixelRatio;
  const { target, tolerance, samples, effects } = options;
  const latestSample = samples.at(-1);
  const viewport = createGraphViewport(
    width,
    height,
    target.frequency,
    tolerance,
    samples,
    GRAPH_SECONDS,
    GRAPH_RANGE_SEMITONES,
  );

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = getGraphTheme().background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.fillStyle = getGraphTheme().inTune;
  context.globalAlpha = 0.12;
  context.fillRect(
    viewport.padding.left,
    viewport.toleranceTop,
    viewport.plotWidth,
    viewport.toleranceBottom - viewport.toleranceTop,
  );
  context.restore();

  drawGrid(context, viewport);
  drawTargetGlow(context, width, viewport, latestSample, tolerance);

  context.strokeStyle = getGraphTheme().target;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(viewport.padding.left, viewport.zeroY);
  context.lineTo(width - viewport.padding.right, viewport.zeroY);
  context.stroke();

  context.fillStyle = getGraphTheme().text;
  context.font = "22px system-ui, sans-serif";
  context.fillText(target.name, viewport.padding.left + 8, viewport.zeroY - 10);

  const comboTier = getComboTier(effects.stableComboMs);
  const trailColor =
    getGraphTheme().comboTiers[comboTier.level - 1] ?? getGraphTheme().voice;

  context.save();

  if (comboTier.level > 0) {
    context.shadowColor = trailColor;
    context.shadowBlur = 4 + comboTier.level * 3;
  }

  context.strokeStyle = trailColor;
  context.lineWidth = 4;
  context.beginPath();

  buildGraphPoints(samples, viewport, GRAPH_SECONDS).forEach((point) => {
    if (point.startsLine) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });

  context.stroke();
  context.restore();
  drawLandingRipples(context, viewport, effects.landingRipples);
  drawComboMilestones(context, width, viewport, effects.comboMilestones);
  drawComboMeter(context, width, viewport, effects.stableComboMs);
  drawGraphLabels(context, width, height, viewport.padding);
  drawCurrentPitchLabel(context, width, viewport, latestSample);
}

function drawComboMilestones(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
  milestones: GameEffectState["comboMilestones"],
) {
  const now = performance.now();

  milestones.forEach((milestone) => {
    if (milestone.timeMs < viewport.startTime) {
      return;
    }

    const age = now - milestone.createdAt;
    const progress = clamp(age / COMBO_MILESTONE_DURATION_MS, 0, 1);
    const alpha = 1 - progress;
    const color =
      getGraphTheme().comboTiers[milestone.level - 1] ?? getGraphTheme().voice;
    const x = clamp(
      viewport.padding.left +
        ((milestone.timeMs - viewport.startTime) / (GRAPH_SECONDS * 1000)) *
          viewport.plotWidth,
      viewport.padding.left + 70,
      width - viewport.padding.right - 70,
    );
    const baseY = midiToY(
      milestone.midi,
      viewport.minMidi,
      viewport.maxMidi,
      viewport.padding,
      viewport.plotHeight,
    );
    const label = `${milestone.label} ×${milestone.multiplier}`;

    context.save();
    context.globalAlpha = alpha;

    const rayCount = 8;
    const rayInner = 8 + progress * 30;
    const rayOuter = rayInner + 10 + milestone.level * 3;

    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();

    for (let i = 0; i < rayCount; i += 1) {
      const angle = (Math.PI * 2 * i) / rayCount + Math.PI / rayCount;
      context.moveTo(
        x + Math.cos(angle) * rayInner,
        baseY + Math.sin(angle) * rayInner,
      );
      context.lineTo(
        x + Math.cos(angle) * rayOuter,
        baseY + Math.sin(angle) * rayOuter,
      );
    }

    context.stroke();

    const textY = Math.max(
      viewport.padding.top + 16,
      baseY - 22 - progress * 26,
    );

    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "800 26px system-ui, sans-serif";
    context.lineWidth = 8;
    context.strokeStyle = getGraphTheme().panel;
    context.globalAlpha = alpha * 0.96;
    context.strokeText(label, x, textY);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillText(label, x, textY);
    context.restore();
  });
}

function drawComboMeter(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
  stableComboMs: number,
) {
  if (stableComboMs <= 0) {
    return;
  }

  const tierProgress = getComboTierProgress(stableComboMs);
  const color =
    getGraphTheme().comboTiers[tierProgress.current.level - 1] ??
    getGraphTheme().voice;
  const meterWidth = 180;
  const meterHeight = 10;
  const x = width - viewport.padding.right - meterWidth;
  const y = viewport.padding.top + 18;
  const text = tierProgress.nextLabel
    ? `次の称号 ${tierProgress.nextLabel} まで`
    : "最高称号キープ中!";

  context.save();
  context.font = "700 14px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  context.lineWidth = 5;
  context.strokeStyle = getGraphTheme().panel;
  context.globalAlpha = 0.9;
  context.strokeText(text, x + meterWidth, y - 6);
  context.globalAlpha = 1;
  context.fillStyle = EFFECT_COLORS.meterLabel;
  context.fillText(text, x + meterWidth, y - 6);

  context.fillStyle = getGraphTheme().text;
  context.globalAlpha = 0.1;
  context.fillRect(x, y, meterWidth, meterHeight);
  context.globalAlpha = 1;
  context.fillStyle = color;
  context.fillRect(x, y, meterWidth * tierProgress.progress, meterHeight);
  context.restore();
}

function drawTargetGlow(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
  latestSample: PitchSample | undefined,
  tolerance: number,
) {
  if (!latestSample || latestSample.centsFromTarget === null) {
    return;
  }

  const distance = Math.abs(latestSample.centsFromTarget);
  const glowStrength = getTargetGlowStrength(distance, tolerance);

  if (glowStrength <= 0) {
    return;
  }

  const centerX = viewport.padding.left + viewport.plotWidth / 2;
  const glowWidth = viewport.plotWidth * (0.42 + glowStrength * 0.34);
  const glowHeight = 24 + glowStrength * 34;
  const gradient = context.createRadialGradient(
    centerX,
    viewport.zeroY,
    4,
    centerX,
    viewport.zeroY,
    glowWidth / 2,
  );

  gradient.addColorStop(
    0,
    `rgba(${EFFECT_COLORS.glowGreenRgb}, ${0.34 * glowStrength})`,
  );
  gradient.addColorStop(
    0.55,
    `rgba(${EFFECT_COLORS.glowGoldRgb}, ${0.2 * glowStrength})`,
  );
  gradient.addColorStop(1, `rgba(${EFFECT_COLORS.glowGoldRgb}, 0)`);

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = gradient;
  context.fillRect(
    Math.max(viewport.padding.left, centerX - glowWidth / 2),
    viewport.zeroY - glowHeight / 2,
    Math.min(glowWidth, width - viewport.padding.left - viewport.padding.right),
    glowHeight,
  );
  context.restore();
}

function drawLandingRipples(
  context: CanvasRenderingContext2D,
  viewport: ReturnType<typeof createGraphViewport>,
  ripples: GameEffectState["landingRipples"],
) {
  const now = performance.now();

  ripples.forEach((ripple) => {
    if (ripple.timeMs < viewport.startTime) {
      return;
    }

    const age = now - ripple.createdAt;
    const progress = clamp(age / LANDING_RIPPLE_DURATION_MS, 0, 1);
    const alpha = (1 - progress) * (0.28 + ripple.intensity * 0.32);
    const radius = 12 + progress * (42 + ripple.intensity * 26);
    const x =
      viewport.padding.left +
      ((ripple.timeMs - viewport.startTime) / (GRAPH_SECONDS * 1000)) *
        viewport.plotWidth;
    const y = midiToY(
      ripple.midi,
      viewport.minMidi,
      viewport.maxMidi,
      viewport.padding,
      viewport.plotHeight,
    );

    context.save();
    context.strokeStyle = `rgba(${EFFECT_COLORS.glowGoldRgb}, ${alpha})`;
    context.lineWidth = 2 + ripple.intensity * 2;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = `rgba(${EFFECT_COLORS.glowGreenRgb}, ${alpha * 0.72})`;
    context.beginPath();
    context.arc(x, y, 4 + ripple.intensity * 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });
}

function drawGrid(
  context: CanvasRenderingContext2D,
  viewport: ReturnType<typeof createGraphViewport>,
) {
  context.strokeStyle = getGraphTheme().border;
  context.lineWidth = 1;
  context.font = "16px system-ui, sans-serif";
  context.fillStyle = getGraphTheme().label;

  for (
    let midi = Math.ceil(viewport.minMidi);
    midi <= Math.floor(viewport.maxMidi);
    midi += 1
  ) {
    const y =
      viewport.padding.top +
      ((viewport.maxMidi - midi) / (viewport.maxMidi - viewport.minMidi)) *
        viewport.plotHeight;
    const isOctave = Math.round(midi - viewport.targetMidi) % 12 === 0;
    const isTarget = Math.round(midi) === Math.round(viewport.targetMidi);

    context.strokeStyle = isTarget
      ? getGraphTheme().target
      : isOctave
        ? getGraphTheme().octave
        : getGraphTheme().grid;
    context.lineWidth = isTarget ? 2 : 1;
    context.beginPath();
    context.moveTo(viewport.padding.left, y);
    context.lineTo(viewport.padding.left + viewport.plotWidth, y);
    context.stroke();

    if (isOctave || isTarget || midi % 2 === 0) {
      context.fillStyle = isTarget
        ? getGraphTheme().text
        : getGraphTheme().label;
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  context.strokeStyle = getGraphTheme().border;
  context.lineWidth = 1;

  for (let second = 0; second <= GRAPH_SECONDS; second += 3) {
    const x =
      viewport.padding.left + (second / GRAPH_SECONDS) * viewport.plotWidth;
    context.beginPath();
    context.moveTo(x, viewport.padding.top);
    context.lineTo(x, viewport.padding.top + viewport.plotHeight);
    context.stroke();
  }
}

function drawGraphLabels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: GraphPadding,
) {
  context.fillStyle = getGraphTheme().label;
  context.font = "16px system-ui, sans-serif";
  context.fillText("音名", 8, 20);
  context.fillText("12秒前", padding.left, height - 10);
  context.fillText("現在", width - padding.right - 38, height - 10);
}

function drawCurrentPitchLabel(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
  latestSample: PitchSample | undefined,
) {
  if (
    !latestSample ||
    latestSample.midi === null ||
    latestSample.note === null
  ) {
    return;
  }

  const label = `${midiToSolfegeName(latestSample.midi)} ${latestSample.note}`;
  const x = width / 2;
  const y = viewport.padding.top + 72;

  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 48px system-ui, sans-serif";

  const metrics = context.measureText(label);
  const labelX = Math.max(
    viewport.padding.left + metrics.width / 2 + 10,
    Math.min(x, width - viewport.padding.right - metrics.width / 2 - 10),
  );
  const labelY = Math.max(viewport.padding.top + 18, y);

  context.lineWidth = 10;
  context.strokeStyle = getGraphTheme().panel;
  context.globalAlpha = 0.96;
  context.strokeText(label, labelX, labelY);
  context.globalAlpha = 1;
  context.fillStyle = getGraphTheme().targetStrong;
  context.fillText(label, labelX, labelY);
  context.restore();
}
