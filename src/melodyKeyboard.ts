import { createPianoKeyboardLayout } from "./graphModel";
import {
  hzToMidi,
  midiToNoteName,
  midiToSolfegeName,
  type Note,
} from "./pitchMath";

const keyboards = new WeakSet<HTMLElement>();

function positionKeyboardEffects(root: HTMLElement) {
  const effects = root.querySelector<HTMLElement>(".melody-keyboard-effects");
  const scroll = root.querySelector<HTMLElement>(".melody-keyboard-scroll");
  const key = root.querySelector<HTMLElement>(".melody-piano-key.is-current");
  if (!effects || !scroll || !key) return;
  const view = scroll.getBoundingClientRect();
  const target = key.getBoundingClientRect();
  effects.hidden =
    !view.width || target.right <= view.left || target.left >= view.right;
  if (effects.hidden) return;
  const bounds = effects.getBoundingClientRect();
  const keyboard = scroll
    .querySelector(".melody-keyboard-keys")
    ?.getBoundingClientRect();
  effects.style.height = `${view.bottom - bounds.top}px`;
  effects.style.setProperty(
    "--key-x",
    `${target.left + target.width / 2 - bounds.left}px`,
  );
  effects.style.setProperty("--key-top", `${target.top - bounds.top}px`);
  effects.style.setProperty(
    "--key-bottom",
    `${(keyboard?.bottom ?? target.bottom) - bounds.top}px`,
  );
}

function playKeyboardSparks(root: HTMLElement) {
  const effects = root.querySelector<HTMLElement>(".melody-keyboard-effects");
  if (!effects) return;
  effects.replaceChildren(
    ...Array.from({ length: 6 }, (_, i) => {
      const spark = document.createElement("span");
      spark.className = `melody-key-spark${i >= 4 ? " is-lower" : ""}`;
      spark.style.setProperty("--dx", `${(i % 2 ? -1 : 1) * (14 + i * 7)}px`);
      spark.style.setProperty("--dy", `${i >= 4 ? 3 : -3 - (i % 3) * 3}px`);
      spark.style.animationDelay = `${i * 40}ms`;
      return spark;
    }),
  );
}

export function followMelodyKeyboard(root: HTMLElement) {
  const scroll = root.querySelector<HTMLElement>(".melody-keyboard-scroll");
  if (!scroll?.clientWidth) return;
  const targets = [
    ...root.querySelectorAll<HTMLElement>(
      ".melody-piano-key.is-current, .melody-piano-key.is-next",
    ),
  ];
  if (!targets.length) return;
  const left = Math.min(...targets.map((key) => key.offsetLeft)) - 12;
  const right =
    Math.max(...targets.map((key) => key.offsetLeft + key.offsetWidth)) + 12;
  if (
    left < scroll.scrollLeft ||
    right > scroll.scrollLeft + scroll.clientWidth
  ) {
    scroll.scrollLeft = Math.max(0, (left + right - scroll.clientWidth) / 2);
  }
  positionKeyboardEffects(root);
}

/** Only the reference targets drive these markers; this is not detected voice. */
export function renderMelodyKeyboard(
  root: HTMLElement,
  notes: Note[],
  index: number,
) {
  const current = notes[index];
  root.hidden = !current;
  if (!current) return;
  const keys = root.querySelector<HTMLElement>(".melody-keyboard-keys");
  const status = root.querySelector<HTMLElement>(".melody-keyboard-status");
  if (!keys || !status) return;
  if (!keyboards.has(root)) {
    const layout = createPianoKeyboardLayout();
    keys.replaceChildren(
      ...layout.keys.map((key) => {
        const element = document.createElement("div");
        element.className = `melody-piano-key ${key.black ? "is-black" : "is-white"}`;
        element.dataset.midi = String(key.midi);
        element.style.left = `${key.left}%`;
        element.style.width = `${key.width}%`;
        const label = document.createElement("span");
        label.className = "melody-key-name";
        label.textContent = midiToSolfegeName(key.midi);
        const name = document.createElement("span");
        name.className = "melody-key-octave";
        name.textContent = midiToNoteName(key.midi);
        label.append(name);
        element.append(label);
        return element;
      }),
    );
    keyboards.add(root);
    root
      .querySelector(".melody-keyboard-scroll")
      ?.addEventListener("scroll", () => positionKeyboardEffects(root), {
        passive: true,
      });
  }
  const next = notes[index + 1];
  const currentMidi = Math.round(hzToMidi(current.frequency));
  const nextMidi = next ? Math.round(hzToMidi(next.frequency)) : null;
  for (const key of keys.querySelectorAll<HTMLElement>(".melody-piano-key")) {
    const midi = Number(key.dataset.midi);
    key.classList.toggle("is-current", midi === currentMidi);
    key.classList.toggle("is-next", midi === nextMidi);
  }
  status.textContent = `いま：${current.solfege} (${current.name}) ／ ${next ? `つぎ：${next.solfege} (${next.name})` : "つぎ：なし（最後の音）"}`;
  followMelodyKeyboard(root);
  playKeyboardSparks(root);
}
