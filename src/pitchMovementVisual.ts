// Shared vector artwork for SVG and Canvas. The bars mirror the pitch graph.
const RISING_PATH = "M4 22v-4m6 4v-8m6 8V14 M4 12l6-4 6 1 7-6m-7 0h7v7";
const LEVEL_PATH = "M4 22v-7m6 7v-7m6 7v-7 M4 8h19m-5-5 5 5-5 5";

export function getPitchMovementIcon(
  fromFrequency: number,
  toFrequency: number,
) {
  const direction = Math.sign(toFrequency - fromFrequency);
  return {
    path: direction === 0 ? LEVEL_PATH : RISING_PATH,
    transform: direction < 0 ? "translate(0 28) scale(1 -1)" : "",
    descending: direction < 0,
  };
}
