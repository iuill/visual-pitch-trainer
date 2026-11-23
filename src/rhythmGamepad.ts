const handButtons = [0, 1, 2, 3]; // A, B, X, Y
const footButtons = [4, 5, 6, 7]; // LB, RB, LT, RT

export type RhythmInputLane = "hand" | "foot";
type RhythmGamepad = Pick<
  Gamepad,
  "id" | "index" | "connected" | "mapping" | "buttons" | "timestamp"
>;

export function createRhythmGamepadPoller() {
  let previous = new Map<number, { id: string; buttons: boolean[] }>();
  let lastPollMs = 0;
  return (
    gamepads: readonly (RhythmGamepad | null)[],
    nowMs: number,
  ): Map<RhythmInputLane, number> => {
    const current = new Map<number, { id: string; buttons: boolean[] }>();
    const taps = new Map<RhythmInputLane, number>();
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
      // Some browsers report zero or leave the timestamp unchanged.
      const stamp = gamepad.timestamp;
      const timeMs = stamp > lastPollMs && stamp <= nowMs ? stamp : nowMs;
      if (handButtons.some(pressed))
        taps.set("hand", Math.min(taps.get("hand") ?? nowMs, timeMs));
      if (footButtons.some(pressed))
        taps.set("foot", Math.min(taps.get("foot") ?? nowMs, timeMs));
    }
    previous = current;
    lastPollMs = nowMs;
    return taps;
  };
}
