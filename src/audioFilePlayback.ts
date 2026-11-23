import { getAudioContext } from "./audioContext";

const PLAYBACK_GAIN = 2;

type PlaybackEvent = "metadata" | "state" | "position";

type PlaybackSource = {
  blob: Blob;
  url: string;
  player: HTMLAudioElement;
  connection?: { source: MediaElementAudioSourceNode; gain: GainNode };
};

export function createAudioFilePlayback(
  onUpdate: (event: PlaybackEvent) => void,
) {
  let current: PlaybackSource | null = null;
  let frame: number | null = null;
  let request = 0;

  function stopTracking() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function trackPosition() {
    frame = null;
    onUpdate("position");
    if (current && !current.player.paused)
      frame = requestAnimationFrame(trackPosition);
  }

  function clear() {
    request++;
    stopTracking();

    const previous = current;
    current = null;
    if (!previous) return;
    const { player, url, connection } = previous;
    connection?.source.disconnect();
    connection?.gain.disconnect();
    player.pause();
    player.removeAttribute("src");
    player.load();
    URL.revokeObjectURL(url);
  }

  function load(blob: Blob | null) {
    clear();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const player = new Audio(url);
    player.preload = "metadata";
    const selected: PlaybackSource = { player, url, blob };
    current = selected;

    player.addEventListener("loadedmetadata", () => {
      if (current === selected) onUpdate("metadata");
    });
    player.addEventListener("play", () => {
      if (current !== selected || player.paused) return;
      onUpdate("state");
      if (frame === null) frame = requestAnimationFrame(trackPosition);
    });
    const onStopped = () => {
      if (current !== selected || (!player.paused && !player.ended)) return;
      stopTracking();
      onUpdate("state");
      onUpdate("position");
    };
    player.addEventListener("pause", onStopped);
    player.addEventListener("ended", onStopped);
    player.addEventListener("timeupdate", () => {
      if (current === selected && frame === null) onUpdate("position");
    });
  }

  async function play() {
    const selected = current;
    if (!selected?.player.paused) return;
    const id = ++request;
    try {
      const context = getAudioContext();
      if (!selected.connection) {
        const source = context.createMediaElementSource(selected.player);
        const gain = context.createGain();
        gain.gain.value = PLAYBACK_GAIN;
        source.connect(gain);
        gain.connect(context.destination);
        selected.connection = { source, gain };
      }
      if (context.state === "suspended") await context.resume();
      if (id === request && current === selected) await selected.player.play();
    } catch (error) {
      if (id === request && current === selected) throw error;
    }
  }

  function pause() {
    request++;
    stopTracking();
    current?.player.pause();
  }

  function seek(time: number) {
    if (!current) return;
    current.player.currentTime = time;
    onUpdate("position");
  }

  return {
    load,
    clear,
    play,
    pause,
    seek,
    hasSource: () => current !== null,
    uses: (blob: Blob) => current?.blob === blob,
    isPlaying: () => current !== null && !current.player.paused,
    getDuration() {
      const duration = current?.player.duration ?? 0;
      return Number.isFinite(duration) ? duration : 0;
    },
    getTime() {
      const time = current?.player.currentTime ?? 0;
      return Number.isFinite(time) ? time : 0;
    },
  };
}
