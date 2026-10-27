import { createMelodyKeyboardLayout } from "./graphModel";
import {
  hzToMidi,
  midiToNoteName,
  midiToSolfegeName,
  type Note,
} from "./pitchMath";

const layouts = new WeakMap<HTMLElement, string>();

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
  const signature = notes.map((note) => note.frequency).join(",");
  if (layouts.get(root) !== signature) {
    const layout = createMelodyKeyboardLayout(
      notes.map((note) => note.frequency),
    );
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
        for (const [type, text] of [
          ["current", "今"],
          ["next", "次"],
        ]) {
          const marker = document.createElement("span");
          marker.className = `melody-key-marker is-${type}`;
          marker.dataset.marker = type;
          const caption = document.createElement("span");
          caption.textContent = text;
          marker.append(caption);
          marker.hidden = true;
          element.append(marker);
        }
        return element;
      }),
    );
    layouts.set(root, signature);
  }
  const next = notes[index + 1];
  const currentMidi = Math.round(hzToMidi(current.frequency));
  const nextMidi = next ? Math.round(hzToMidi(next.frequency)) : null;
  for (const key of keys.querySelectorAll<HTMLElement>(".melody-piano-key")) {
    const midi = Number(key.dataset.midi);
    key.classList.toggle("is-current", midi === currentMidi);
    key.classList.toggle("is-next", midi === nextMidi);
    key
      .querySelector<HTMLElement>('[data-marker="current"]')
      ?.toggleAttribute("hidden", midi !== currentMidi);
    key
      .querySelector<HTMLElement>('[data-marker="next"]')
      ?.toggleAttribute("hidden", midi !== nextMidi);
  }
  status.textContent = `いま：${current.solfege} (${current.name}) ／ ${next ? `つぎ：${next.solfege} (${next.name})` : "つぎ：なし（最後の音）"}`;
}
