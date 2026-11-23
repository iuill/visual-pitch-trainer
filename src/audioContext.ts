declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let context: AudioContext | null = null;

export function isAudioContextSupported(): boolean {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

export function createAudioContext(): AudioContext {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error("AudioContext is not available.");
  return new Context();
}

export function getAudioContext(): AudioContext {
  context ??= createAudioContext();
  if (context.state === "suspended") {
    void context.resume();
  }
  return context;
}

export function peekAudioContext(): AudioContext | null {
  return context;
}

export function closeAudioContext() {
  const previous = context;
  context = null;
  if (previous && previous.state !== "closed") void previous.close();
}
