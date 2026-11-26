import {
  RHYTHM_NOTE_BEATS,
  type RhythmNoteValue,
  type RhythmRestValue,
} from "./rhythmCourse";

export function createFootprint() {
  const icon = document.createElement("span");
  icon.className = "rhythm-footprint";
  return icon;
}

export function createNoteIcon(value: RhythmNoteValue) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.classList.add("rhythm-note-icon");
  icon.dataset.noteValue = value;
  icon.setAttribute("viewBox", "0 0 28 28");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("aria-hidden", "true");
  if (value !== "whole") {
    const stem = document.createElementNS(svgNamespace, "path");
    stem.setAttribute(
      "d",
      RHYTHM_NOTE_BEATS[value] < 1
        ? "M17.5 21V3h2c.6 2.4 2.3 3.7 4 5 1.5 1.2 2.5 2.5 2.5 4.5 0 1.6-.6 2.9-1.7 4 .6-1.4.6-2.6.1-3.5-.8-1.6-2.6-2.3-4.9-3.1V21Z"
        : "M18 20V3h2v17Z",
    );
    icon.append(stem);
    if (value === "sixteenth") {
      const secondFlag = stem.cloneNode() as SVGPathElement;
      secondFlag.setAttribute("transform", "translate(0 5)");
      icon.append(secondFlag);
    }
  }
  const head = document.createElementNS(svgNamespace, "ellipse");
  head.setAttribute("cx", "14");
  head.setAttribute("cy", value === "whole" ? "14" : "21");
  head.setAttribute("rx", value === "whole" ? "7" : "6");
  head.setAttribute("ry", "3.9");
  if (value !== "whole") head.setAttribute("transform", "rotate(-20 14 21)");
  if (value === "whole" || value === "half" || value === "dotted-half") {
    head.setAttribute("fill", "none");
    head.setAttribute("stroke", "currentColor");
    head.setAttribute("stroke-width", "2.2");
  }
  icon.append(head);
  if (value.startsWith("dotted-")) {
    const dot = document.createElementNS(svgNamespace, "circle");
    dot.setAttribute("cx", "24");
    dot.setAttribute("cy", "20");
    dot.setAttribute("r", "1.8");
    icon.append(dot);
  }
  return icon;
}

export function createRestIcon(value: RhythmRestValue) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.classList.add("rhythm-rest-icon");
  icon.dataset.restValue = value;
  icon.setAttribute("viewBox", "0 0 24 28");
  icon.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(svgNamespace, "path");
  shape.setAttribute("fill", "currentColor");
  shape.setAttribute(
    "d",
    value === "eighth"
      ? "M9 7a3 3 0 1 0 2.9 3.5c1.6.2 3-.2 4.8-1.3L11 25h2l7-20h-2c-1.1 2.5-3.4 4.4-6.8 3.4A3 3 0 0 0 9 7Z"
      : "M10 1.5 17 9l-5 5 4 6c-2.6-1.34-5-.9-5.5 1.2-.4 1.65.6 3.3 2.8 4.8-3.8-.5-6.1-3.1-5.3-5.8.45-1.52 1.7-2.58 3.55-2.92l-4-5.38 4.8-5.05Z",
  );
  icon.append(shape);
  return icon;
}
