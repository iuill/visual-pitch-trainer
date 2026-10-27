import { createPianoKeyboardLayout } from "./graphModel";
import {
  hzToMidi,
  midiToNoteName,
  midiToSolfegeName,
  type Note,
} from "./pitchMath";

const keyboards = new WeakSet<HTMLElement>();

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
}
