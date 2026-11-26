import type { RhythmStep } from "./rhythmCourse";
import { createFootprint, createNoteIcon, createRestIcon } from "./rhythmIcons";
import {
  createRhythmPattern,
  createRhythmPatternLegend,
} from "./rhythmPracticeModel";

export function renderRhythmPatternLegend(
  element: HTMLElement,
  step: RhythmStep,
  patterns: readonly string[],
) {
  const items = createRhythmPatternLegend(step, patterns).map((item) => {
    const entry = document.createElement("li");
    entry.append(
      item.kind === "note"
        ? createNoteIcon(item.value)
        : createRestIcon(item.value),
      item.label,
    );
    return entry;
  });
  element.replaceChildren(...items);
  element.hidden = items.length === 0;
}

export function createRhythmPatternCard(step: RhythmStep, pattern: string) {
  const { slots, subdivided, label } = createRhythmPattern(step, pattern);
  const card = document.createElement("div");
  card.className = "rhythm-pattern";
  card.dataset.subdivided = String(subdivided);
  card.dataset.dense = String(slots.length > 8);
  card.style.setProperty("--rhythm-slots", String(slots.length));
  card.setAttribute("role", "img");
  card.setAttribute("aria-label", label);

  function addRow(label: string, kind: "count" | "note" | "beat") {
    const heading = document.createElement("span");
    heading.className = "rhythm-pattern-label";
    if (kind === "beat") heading.classList.add("rhythm-pattern-foot-row");
    heading.setAttribute("aria-hidden", "true");
    heading.textContent = label;
    card.append(heading);

    for (const slot of slots) {
      const cell = document.createElement("span");
      cell.className = `rhythm-pattern-${kind}`;
      if (kind === "beat") cell.classList.add("rhythm-pattern-foot-row");
      cell.setAttribute("aria-hidden", "true");
      cell.dataset.exampleSlot = String(slot.index);
      if (
        slot.accent &&
        ((kind === "note" && slot.noteValue) || (kind === "beat" && slot.foot))
      ) {
        cell.classList.add("rhythm-pattern-downbeat");
      }
      if (slot.groupStart) cell.classList.add("rhythm-pattern-group-start");

      if (kind === "count") {
        cell.textContent = slot.count;
      } else if (kind === "beat") {
        if (slot.foot) cell.append(createFootprint());
      } else if (slot.noteValue) {
        cell.append(createNoteIcon(slot.noteValue));
      } else if (slot.restValue) {
        cell.append(createRestIcon(slot.restValue));
      } else {
        cell.textContent = slot.note;
      }
      card.append(cell);
    }
  }

  addRow("拍", "count");
  if (!step.feetOnly) addRow("手", "note");
  addRow(step.feetOnly ? "足＋タップ" : "足", "beat");
  return card;
}
