import type { RhythmGuide } from "./rhythmCalibration";
import { RHYTHM_STEPS, type RhythmStep } from "./rhythmCourse";

export interface RhythmStepProgress {
  cleared: boolean;
  streak: number;
  bestPerfectRate: number;
  attempts: number;
  lastPlayedAt: string;
}

export interface RhythmProgress {
  version: 1;
  steps: Record<string, RhythmStepProgress>;
  currentStepId: string;
}

export interface RhythmCalibration {
  version: 1;
  visualOffsetMs: number | null;
  audioOffsetMs: number | null;
  measuredAt?: string;
  audioMeasuredAt?: string;
}

export type RhythmSound = "voice" | "click" | "none";
export type RhythmCountVoice = "male" | "female";

export interface RhythmSettings {
  sound: RhythmSound;
  countVoice: RhythmCountVoice;
  volume: number;
  effects: boolean;
  guide: RhythmGuide;
  freePlay: boolean;
  exampleVoice: boolean;
}

const prefix = "rhythm-course:v1:";
const defaultSettings: RhythmSettings = {
  sound: "voice",
  countVoice: "male",
  volume: 0.65,
  effects: true,
  guide: "visual",
  freePlay: false,
  exampleVoice: false,
};

export function newRhythmProgress(): RhythmProgress {
  return { version: 1, steps: {}, currentStepId: RHYTHM_STEPS[0].id };
}

export function rhythmStepUnlocked(
  progress: RhythmProgress,
  step: RhythmStep,
): boolean {
  const index = RHYTHM_STEPS.indexOf(step);
  return (
    index >= 0 &&
    RHYTHM_STEPS.slice(0, index).every(
      (previous) => progress.steps[previous.id]?.cleared === true,
    )
  );
}

export function recordRhythmAttempt(
  progress: RhythmProgress,
  step: RhythmStep,
  result: { perfectRate: number; passed: boolean },
  playedAt: string,
): RhythmStepProgress {
  const previous = progress.steps[step.id];
  const streak = result.passed
    ? Math.min(step.requiredStreak, (previous?.streak ?? 0) + 1)
    : 0;
  const record = {
    cleared: Boolean(previous?.cleared || streak === step.requiredStreak),
    streak,
    bestPerfectRate: Math.max(
      previous?.bestPerfectRate ?? 0,
      result.perfectRate,
    ),
    attempts: (previous?.attempts ?? 0) + 1,
    lastPlayedAt: playedAt,
  };
  progress.steps[step.id] = record;
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function inRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number" && value >= minimum && value <= maximum;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function createRhythmProgressStore(onUnavailable: () => void) {
  let reported = false;
  function report() {
    if (reported) return;
    reported = true;
    onUnavailable();
  }

  function read(key: string) {
    let value: string | null;
    try {
      value = localStorage.getItem(prefix + key);
    } catch {
      report();
      return {};
    }
    try {
      return asRecord(JSON.parse(value ?? "null"));
    } catch {
      return {};
    }
  }

  function write(
    key: string,
    value: RhythmProgress | RhythmCalibration | RhythmSettings | null,
  ) {
    try {
      localStorage.setItem(prefix + key, JSON.stringify(value));
    } catch {
      report();
    }
  }

  return {
    loadProgress(): RhythmProgress {
      const progress = newRhythmProgress();
      const data = read("progress");
      if (data.version !== 1) return progress;
      const records = asRecord(data.steps);
      for (const step of RHYTHM_STEPS) {
        const record = asRecord(records[step.progressKey ?? step.id]);
        const { cleared, streak, bestPerfectRate, attempts, lastPlayedAt } =
          record;
        if (
          typeof cleared !== "boolean" ||
          !inRange(streak, 0, Number.MAX_SAFE_INTEGER) ||
          !Number.isInteger(streak) ||
          !inRange(bestPerfectRate, 0, 1) ||
          !inRange(attempts, 1, Number.MAX_SAFE_INTEGER) ||
          !Number.isInteger(attempts) ||
          !isDate(lastPlayedAt)
        )
          continue;
        progress.steps[step.id] = {
          cleared: cleared || streak >= step.requiredStreak,
          streak: Math.min(streak, step.requiredStreak),
          bestPerfectRate,
          attempts,
          lastPlayedAt,
        };
      }
      const lastStep = RHYTHM_STEPS.find(
        (step) => step.id === data.currentStepId,
      );
      if (lastStep) progress.currentStepId = lastStep.id;
      else
        progress.currentStepId = (
          RHYTHM_STEPS.find((step) => !progress.steps[step.id]?.cleared) ??
          RHYTHM_STEPS.at(-1) ??
          RHYTHM_STEPS[0]
        ).id;
      return progress;
    },
    loadCalibration(): RhythmCalibration | null {
      const {
        version,
        visualOffsetMs,
        audioOffsetMs,
        measuredAt,
        audioMeasuredAt,
      } = read("calibration");
      const visual = inRange(visualOffsetMs, -375, 375) && isDate(measuredAt);
      const audio = inRange(audioOffsetMs, -375, 375);
      if (version !== 1 || (!visual && !audio)) return null;
      return {
        version,
        visualOffsetMs: visual ? visualOffsetMs : null,
        measuredAt: visual ? measuredAt : undefined,
        audioOffsetMs: audio ? audioOffsetMs : null,
        audioMeasuredAt: isDate(audioMeasuredAt) ? audioMeasuredAt : undefined,
      };
    },
    loadSettings(): RhythmSettings {
      const {
        sound,
        countVoice,
        volume,
        effects,
        guide,
        freePlay,
        exampleVoice,
      } = read("settings");
      return {
        sound:
          sound === "voice" || sound === "click" || sound === "none"
            ? sound
            : defaultSettings.sound,
        countVoice:
          countVoice === "female" ? "female" : defaultSettings.countVoice,
        volume: inRange(volume, 0, 1) ? volume : defaultSettings.volume,
        effects:
          typeof effects === "boolean" ? effects : defaultSettings.effects,
        guide: guide === "audio" ? guide : defaultSettings.guide,
        freePlay: freePlay === true,
        exampleVoice: exampleVoice === true,
      };
    },
    saveProgress(value: RhythmProgress) {
      const steps: RhythmProgress["steps"] = {};
      for (const step of RHYTHM_STEPS) {
        const record = value.steps[step.id];
        if (record) steps[step.progressKey ?? step.id] = record;
      }
      write("progress", { ...value, steps });
    },
    saveCalibration: (value: RhythmCalibration | null) =>
      write("calibration", value),
    saveSettings: (value: RhythmSettings) => write("settings", value),
  };
}
