import { getAudioContext, isAudioContextSupported } from "./audioContext";
import type { CommonSettings, ReferencePlayback } from "./commonSettings";
import { queryElement } from "./dom";
import { observeGraphResize } from "./graphCanvas";
import { createMelodyPracticeView } from "./melodyPracticeView";
import {
  formatMicrophoneError,
  type MicrophoneCapture,
  MicrophoneInput,
  PRACTICE_MIC_FFT_SIZE,
} from "./microphone";
import { createPracticeReadout } from "./practiceReadout";
import { createSinglePracticeView } from "./singlePracticeView";

type PracticeMode = "single" | "melody";

export function setupPracticeView(
  settings: CommonSettings,
  playback: ReferencePlayback,
) {
  const graphPanel = queryElement<HTMLElement>(".graph-panel");
  const graphTitle = queryElement<HTMLElement>("#practiceGraphTitle");
  const graphHelp = queryElement<HTMLElement>("#practiceGraphHelp");
  const clearGraphButton = queryElement<HTMLButtonElement>("#clearGraphButton");
  const playToneButton = queryElement<HTMLButtonElement>("#playToneButton");
  const micButton = queryElement<HTMLButtonElement>("#micButton");
  const singleElements =
    document.querySelectorAll<HTMLElement>("[data-single-only]");
  const readout = createPracticeReadout(settings.getSettings);
  const microphone = new MicrophoneInput();
  let practiceView: PracticeMode | null = "single";
  let referencePlaybackRequestId = 0;
  let isReferencePlaying = false;

  const single = createSinglePracticeView(settings, {
    readout,
    isActive: () => microphone.isActive,
    targetChanged: (frequency) =>
      playback.getCurrentPlayer()?.setFrequency(frequency),
  });
  const melody = createMelodyPracticeView(settings, playback, {
    readout,
    input: {
      start: () =>
        startMicrophone(melody.onFrame, () => {
          melody.stop();
          readout.status.textContent = disconnectedMessage;
        }),
      stop: () => microphone.stop(),
    },
    controls: {
      prepare() {
        microphone.stop();
        settings.stopPreview();
        stopReferenceTone();
      },
      setLocked(locked) {
        graphPanel.classList.toggle("is-melody-running", locked);
        settings.lockInputControls(locked);
        clearGraphButton.disabled = locked;
        if (locked) settings.close();
      },
    },
  });

  const disconnectedMessage =
    "マイクが切断されました。接続を確認して、もう一度開始してください。";

  function show(view: PracticeMode | null) {
    practiceView = view;
    const isMelody = view === "melody";
    for (const element of singleElements) element.hidden = view !== "single";
    graphPanel.hidden = view === null;
    single.show(view === "single");
    melody.show(isMelody);
    graphTitle.textContent = isMelody ? "お手本と自分の声" : "声の軌跡";
    graphHelp.textContent = isMelody
      ? "お手本は全体を表示し、終わった音も残します。自分の声を重ねて振り返れます。"
      : "直近12秒の声の高さを、音名のレーンに沿って表示します。";
    requestAnimationFrame(redraw);
  }

  function redraw() {
    if (practiceView === "melody") {
      melody.draw();
      melody.followKeyboard();
    } else if (practiceView === "single") single.draw();
  }

  single.init();
  melody.init();
  redraw();
  const dispose = observeGraphResize(
    [single.canvas, melody.graphScroll],
    redraw,
  );
  clearGraphButton.addEventListener("click", () => {
    if (practiceView === "melody") melody.clear();
    else if (practiceView === "single") single.clear();
  });
  settings.onChange((key, previous) => {
    switch (key) {
      case "startMidi":
        melody.stop();
        single.changeRange(previous.startMidi);
        melody.refresh();
        break;
      case "instrument":
        handleReferenceInstrumentChange();
        break;
      case "tolerance":
        melody.updateTolerance(settings.getSettings().tolerance);
        redraw();
        break;
      case "deviceId":
        if (practiceView === "single" && microphone.isActive) {
          stopSingleMicrophone();
          void requestSingleMicrophone(true);
        }
        break;
    }
  });

  if (isAudioContextSupported()) {
    playToneButton.addEventListener("click", () => void toggleReferenceTone());
    micButton.addEventListener("click", () => {
      if (microphone.isStarting || microphone.isActive) stopSingleMicrophone();
      else void requestSingleMicrophone();
    });
  } else {
    playToneButton.disabled = true;
    micButton.disabled = true;
    single.setStatus(
      "このブラウザでは声の稽古を始められません。別のブラウザで開いてください。",
    );
  }

  return {
    show,
    stop() {
      if (practiceView === "melody") melody.stop();
      else if (microphone.isActive || microphone.isStarting)
        stopSingleMicrophone();
      stopReferenceTone();
    },
    dispose,
  };

  async function startMicrophone(
    onFrame: (now: number, capture: MicrophoneCapture) => void,
    onEnded: () => void,
  ) {
    const capture = await microphone.start(getAudioContext, {
      deviceId: settings.getSettings().deviceId,
      fftSize: PRACTICE_MIC_FFT_SIZE,
      onEnded,
    });
    if (!capture || !microphone.isCurrent(capture)) return null;
    microphone.startFrames(onFrame);
    void settings
      .refreshAudioDevices(() => microphone.isActive)
      .then(() => {
        if (microphone.isCurrent(capture))
          settings.showActiveMicrophone(capture.deviceLabel);
      });
    return capture;
  }

  async function requestSingleMicrophone(switching = false) {
    updateMicButton("starting");
    single.setStatus("稽古の準備中です。マイクの利用を許可してください。");
    try {
      const capture = await startMicrophone(single.onFrame, () => {
        stopSingleMicrophone();
        single.setStatus(disconnectedMessage);
      });
      if (!capture || !microphone.isCurrent(capture)) return;
      single.start();
      updateMicButton("active");
      if (matchMedia("(max-width: 820px)").matches) {
        settings.close();
        requestAnimationFrame(() => {
          if (!microphone.isCurrent(capture)) return;
          graphPanel.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        });
      }
    } catch (error) {
      single.setStatus(
        switching
          ? "選択したマイクで稽古を始められませんでした。別の入力を選択してください。"
          : formatMicrophoneError(error),
      );
      if (switching) settings.showMicrophoneSwitchError();
      console.error(error);
    } finally {
      if (!microphone.isActive && !microphone.isStarting)
        updateMicButton("stopped");
    }
  }

  function stopSingleMicrophone() {
    microphone.stop();
    single.stop();
    updateMicButton("stopped");
  }

  function updateMicButton(status: "active" | "starting" | "stopped") {
    micButton.classList.toggle("is-active", status !== "stopped");
    if (status === "active") {
      micButton.innerHTML = `<span aria-hidden="true">■</span>稽古停止`;
    } else if (status === "starting") {
      micButton.innerHTML = `<span aria-hidden="true">■</span>準備を中止`;
    } else {
      micButton.innerHTML = `<span aria-hidden="true">●</span>稽古開始`;
    }
  }

  function handleReferenceInstrumentChange() {
    const wasPlaying = isReferencePlaying;
    stopReferenceTone();
    melody.stop();
    if (wasPlaying) void startReferenceTone();
  }

  async function toggleReferenceTone() {
    if (isReferencePlaying) {
      stopReferenceTone();
      return;
    }
    await startReferenceTone();
  }

  async function startReferenceTone() {
    settings.stopPreview();
    melody.stop();
    const requestId = ++referencePlaybackRequestId;
    const instrument = settings.getSettings().instrument;
    isReferencePlaying = true;
    playToneButton.classList.add("is-active");
    playToneButton.innerHTML = `<span aria-hidden="true">■</span>停止`;
    playToneButton.setAttribute("aria-pressed", "true");
    settings.showReferencePreparing();
    try {
      const context = getAudioContext();
      const player = playback.getPlayer();
      await player.prepare(instrument);
      if (requestId !== referencePlaybackRequestId) return;
      await context.resume();
      if (requestId !== referencePlaybackRequestId) return;
      player.startReference(instrument, single.frequency);
      settings.resetReferenceStatus();
    } catch (error) {
      if (requestId !== referencePlaybackRequestId) return;
      stopReferenceTone();
      settings.reportReferenceError(error);
    }
  }

  function stopReferenceTone() {
    referencePlaybackRequestId++;
    playback.getCurrentPlayer()?.stopReference();
    isReferencePlaying = false;
    playToneButton.classList.remove("is-active");
    playToneButton.innerHTML = `<span aria-hidden="true">▶</span>お手本音`;
    playToneButton.setAttribute("aria-pressed", "false");
    settings.resetReferenceStatus();
  }
}
