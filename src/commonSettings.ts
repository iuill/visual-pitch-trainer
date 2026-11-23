import { getAudioContext, isAudioContextSupported } from "./audioContext";
import { queryElement } from "./dom";
import { midiToNoteName } from "./pitchMath";
import {
  buildInstrumentPreview,
  isReferenceInstrumentId,
  REFERENCE_INSTRUMENTS,
  type ReferenceInstrumentId,
} from "./referenceInstruments";
import type { ReferencePlayer } from "./referencePlayer";
import { setupSettingsDialog } from "./settingsDialog";

type Settings = Readonly<{
  startMidi: number;
  instrument: ReferenceInstrumentId;
  volume: number;
  tolerance: number;
  minRms: number;
  deviceId: string;
}>;

export type ReferencePlayback = {
  getPlayer(): ReferencePlayer;
  getCurrentPlayer(): ReferencePlayer | null;
};

type SettingsListener = (key: keyof Settings, previous: Settings) => void;

export function setupCommonSettings(
  playback: ReferencePlayback,
  beforePreview: () => void,
) {
  const elements = {
    dialog: queryElement<HTMLDialogElement>("#practiceSettings"),
    opener: queryElement<HTMLButtonElement>("#openPracticeSettings"),
    range: queryElement<HTMLSelectElement>("#noteRangeSelect"),
    instrument: queryElement<HTMLSelectElement>("#referenceInstrumentSelect"),
    preview: queryElement<HTMLButtonElement>("#previewInstrumentButton"),
    referenceStatus: queryElement<HTMLElement>("#referenceInstrumentStatus"),
    volume: queryElement<HTMLInputElement>("#referenceVolumeInput"),
    volumeValue: queryElement<HTMLOutputElement>("#referenceVolumeValue"),
    mic: queryElement<HTMLSelectElement>("#micSelect"),
    micStatus: queryElement<HTMLElement>("#micDeviceStatus"),
    tolerance: queryElement<HTMLInputElement>("#toleranceInput"),
    toleranceValue: queryElement<HTMLOutputElement>("#toleranceValue"),
    sensitivity: queryElement<HTMLInputElement>("#sensitivityInput"),
    sensitivityValue: queryElement<HTMLOutputElement>("#sensitivityValue"),
    rangeSummary: queryElement<HTMLElement>("#settingsSummaryRange"),
    instrumentSummary: queryElement<HTMLElement>("#settingsSummaryInstrument"),
    volumeSummary: queryElement<HTMLElement>("#settingsSummaryVolume"),
    toleranceSummary: queryElement<HTMLElement>("#settingsSummaryTolerance"),
  };

  const initialInstrument = elements.instrument.value;
  let values: Settings = {
    startMidi: Number(elements.range.value),
    instrument: isReferenceInstrumentId(initialInstrument)
      ? initialInstrument
      : "piano",
    volume: Number(elements.volume.value) / 100,
    tolerance: Number(elements.tolerance.value),
    minRms: Number(elements.sensitivity.value) / 1000,
    deviceId: elements.mic.value,
  };
  const listeners: SettingsListener[] = [];
  let previewRequest: symbol | null = null;
  let previewTimer: number | undefined;

  function update<Key extends keyof Settings>(key: Key, value: Settings[Key]) {
    const previous = values;
    if (previous[key] === value) return;
    values = { ...previous, [key]: value };
    renderValues();
    if (key === "instrument") resetReferenceStatus();
    for (const listener of listeners) listener(key, previous);
  }

  function renderValues() {
    const { startMidi, instrument, volume, tolerance, minRms } = values;
    const volumeText = `${Math.round(volume * 100)}%`;
    elements.rangeSummary.textContent = `${midiToNoteName(startMidi)}〜${midiToNoteName(startMidi + 12)}`;
    elements.instrumentSummary.textContent =
      REFERENCE_INSTRUMENTS[instrument].label;
    elements.volumeSummary.textContent = volumeText;
    elements.volumeValue.textContent = volumeText;
    elements.toleranceSummary.textContent = `±半音の${tolerance}%`;
    elements.toleranceValue.textContent = `半音の${tolerance}%`;
    const sensitivity = minRms * 1000;
    elements.sensitivityValue.textContent =
      sensitivity <= 4 ? "よく拾う" : sensitivity >= 12 ? "控えめ" : "ふつう";
  }

  function resetReferenceStatus() {
    setReferenceStatus(REFERENCE_INSTRUMENTS[values.instrument].description);
  }

  function setReferenceStatus(message: string) {
    elements.referenceStatus.textContent = message;
  }

  function reportReferenceError(error: unknown) {
    console.error(error);
    setReferenceStatus(
      "お手本音を再生できませんでした。もう一度再生するか、正弦波を選んでください。",
    );
  }

  async function previewInstrument() {
    if (previewRequest !== null) {
      stopPreview();
      return;
    }
    beforePreview();

    const request = Symbol();
    previewRequest = request;
    const { instrument, startMidi } = values;
    elements.preview.textContent = "試聴を停止";
    setReferenceStatus("試聴音を準備しています…");
    try {
      const context = getAudioContext();
      const player = playback.getPlayer();
      await Promise.all([player.prepare(instrument), context.resume()]);
      if (previewRequest !== request || !elements.dialog.open) return;
      const seconds = player.playPhrase(
        instrument,
        buildInstrumentPreview(startMidi),
      );
      setReferenceStatus("「きらきら星」を試聴中…");
      previewTimer = window.setTimeout(stopPreview, seconds * 1000);
    } catch (error) {
      if (previewRequest !== request || !elements.dialog.open) return;
      stopPreview();
      reportReferenceError(error);
    }
  }

  function stopPreview() {
    if (previewRequest === null) return;
    previewRequest = null;
    window.clearTimeout(previewTimer);
    previewTimer = undefined;
    playback.getCurrentPlayer()?.stopScale();
    elements.preview.textContent = "試聴";
    resetReferenceStatus();
  }

  function selectedMicrophoneLabel() {
    return elements.mic.selectedOptions[0]?.textContent || "既定のマイク";
  }

  async function refreshAudioDevices(inputIsActive = () => false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      elements.micStatus.textContent =
        "このブラウザではマイク一覧を取得できません。";
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const selectedId = values.deviceId || elements.mic.value;
      elements.mic.replaceChildren(
        new Option("既定のマイク", ""),
        ...inputs.map(
          (device, index) =>
            new Option(device.label || `マイク ${index + 1}`, device.deviceId),
        ),
      );

      const deviceId = inputs.some((device) => device.deviceId === selectedId)
        ? selectedId
        : "";
      elements.mic.value = deviceId;
      // A refresh can clear a stale selection without restarting an active input.
      if (deviceId !== values.deviceId) values = { ...values, deviceId };

      if (inputs.length === 0) {
        elements.micStatus.textContent = "利用可能なマイクが見つかりません。";
      } else if (!inputIsActive() && inputs.some((device) => !device.label)) {
        elements.micStatus.textContent = "稽古開始後に入力名を表示できます。";
      } else {
        elements.micStatus.textContent = `選択中: ${selectedMicrophoneLabel()}`;
      }
    } catch (error) {
      elements.micStatus.textContent = "マイク一覧を取得できませんでした。";
      console.error(error);
    }
  }

  setupSettingsDialog(elements.dialog, elements.opener);
  elements.dialog.addEventListener("close", stopPreview);
  elements.instrument.replaceChildren(
    ...Object.values(REFERENCE_INSTRUMENTS).map(
      (instrument) => new Option(instrument.label, instrument.id),
    ),
  );
  elements.instrument.value = values.instrument;
  renderValues();
  resetReferenceStatus();

  elements.range.addEventListener("change", () => {
    stopPreview();
    update("startMidi", Number(elements.range.value));
  });
  elements.instrument.addEventListener("change", () => {
    const instrument = elements.instrument.value;
    if (!isReferenceInstrumentId(instrument)) return;
    stopPreview();
    update("instrument", instrument);
  });
  elements.volume.addEventListener("input", () => {
    const volume = Number(elements.volume.value) / 100;
    update("volume", volume);
    playback.getCurrentPlayer()?.setVolume(volume);
  });
  elements.tolerance.addEventListener("input", () => {
    update("tolerance", Number(elements.tolerance.value));
  });
  elements.sensitivity.addEventListener("input", () => {
    update("minRms", Number(elements.sensitivity.value) / 1000);
  });
  elements.mic.addEventListener("change", () => {
    elements.micStatus.textContent = `選択中: ${selectedMicrophoneLabel()}`;
    update("deviceId", elements.mic.value);
  });
  if (isAudioContextSupported()) {
    elements.preview.addEventListener("click", () => void previewInstrument());
    void refreshAudioDevices();
  } else {
    elements.instrument.disabled = true;
    elements.preview.disabled = true;
    elements.micStatus.textContent =
      "音声機能が使えないため、マイクを取得できません。";
  }

  return {
    getSettings: () => values,
    onChange(listener: SettingsListener) {
      listeners.push(listener);
    },
    onCommit(listener: () => void) {
      elements.dialog.addEventListener("change", listener);
    },
    close: () => elements.dialog.close(),
    lockInputControls(locked: boolean) {
      elements.mic.disabled = locked;
      elements.tolerance.disabled = locked;
      elements.sensitivity.disabled = locked;
    },
    refreshAudioDevices,
    showActiveMicrophone(track: MediaStreamTrack | undefined) {
      // The active label is informational. The user's default selection stays empty.
      elements.micStatus.textContent = `使用中: ${track?.label || selectedMicrophoneLabel()}`;
    },
    showMicrophoneSwitchError() {
      elements.micStatus.textContent = "マイクの切り替えに失敗しました。";
    },
    stopPreview,
    showReferencePreparing() {
      setReferenceStatus("お手本音を準備しています…");
    },
    resetReferenceStatus,
    reportReferenceError,
  };
}

export type CommonSettings = ReturnType<typeof setupCommonSettings>;
