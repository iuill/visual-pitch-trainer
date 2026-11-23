const handButtons = [0, 1, 2, 3]; // A, B, X, Y
const footButtons = [4, 5, 6, 7]; // LB, RB, LT, RT

export type RhythmInputLane = "hand" | "foot";
type RhythmGamepad = Pick<
  Gamepad,
  "id" | "index" | "connected" | "mapping" | "buttons"
>;

export function createRhythmGamepadPoller() {
  let previous = new Map<number, { id: string; buttons: boolean[] }>();
  return (
    gamepads: readonly (RhythmGamepad | null)[],
  ): Set<RhythmInputLane> => {
    const current = new Map<number, { id: string; buttons: boolean[] }>();
    const taps = new Set<RhythmInputLane>();
    for (const gamepad of gamepads) {
      if (!gamepad?.connected || gamepad.mapping !== "standard") continue;
      const buttons = gamepad.buttons.map(
        (button) => button.pressed || button.value >= 0.5,
      );
      current.set(gamepad.index, { id: gamepad.id, buttons });
      const last = previous.get(gamepad.index);
      if (last && last.id !== gamepad.id) continue;
      const pressed = (index: number) =>
        buttons[index] && !last?.buttons[index];
      if (handButtons.some(pressed)) taps.add("hand");
      if (footButtons.some(pressed)) taps.add("foot");
    }
    previous = current;
    return taps;
  };
}
