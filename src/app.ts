import { closeAudioContext, getAudioContext } from "./audioContext";
import { setupAudioFileView } from "./audioFileView";
import { type ReferencePlayback, setupCommonSettings } from "./commonSettings";
import { queryElement } from "./dom";
import { GamePractice } from "./gamePractice";
import { setupPracticeView } from "./practiceView";
import { setupPwa } from "./pwa";
import { ReferencePlayer } from "./referencePlayer";
import { VoiceRangeCheck } from "./voiceRangeCheck";
import "../styles.css";

type View = {
  show(visible: boolean): void;
  stop(): void;
  settingsChanged?(): void;
};

function init() {
  setupPwa();
  updateBuildInfo();

  let referencePlayer: ReferencePlayer | null = null;
  const playback: ReferencePlayback = {
    getPlayer() {
      if (!referencePlayer) {
        referencePlayer = new ReferencePlayer(getAudioContext());
        referencePlayer.setVolume(settings.getSettings().volume);
      }
      return referencePlayer;
    },
    getCurrentPlayer: () => referencePlayer,
  };
  const settings = setupCommonSettings(playback, () => {
    views[currentView].view.stop();
  });
  const practice = setupPracticeView(settings, playback);
  const audio = setupAudioFileView();
  const game = new GamePractice(settings.getSettings, settings.stopPreview);
  const range = new VoiceRangeCheck(settings.getSettings, settings.stopPreview);
  const views = {
    single: {
      description: "音をひとつ選び、お手本に合わせて声を伸ばします。",
      view: {
        show: (visible) => practice.show(visible ? "single" : null),
        stop: practice.stop,
      },
    },
    melody: {
      description:
        "お手本と一緒に歌い、停止するまで繰り返します。停止後に音ごとに振り返れます。",
      view: {
        show: (visible) => practice.show(visible ? "melody" : null),
        stop: practice.stop,
      },
    },
    games: {
      description:
        "ランダムな目標音への発声と、鳴った音を当てるゲームに挑戦できます。",
      view: game,
    },
    range: {
      description:
        "マイクで自分の声域をチェックします。安定して出せた音を3通りの表記で確認できます。",
      view: range,
    },
    audio: {
      description: "音源や動画を読み込み、歌声の高さの目安を確認します。",
      view: audio,
    },
  } satisfies Record<string, { description: string; view: View }>;
  type ViewId = keyof typeof views;
  let currentView: ViewId = "single";
  const description = queryElement<HTMLElement>("#practiceViewDescription");
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    "button[data-practice-view]",
  );
  const showCurrentView = () => {
    document.body.dataset.practiceView = currentView;
    for (const button of buttons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.practiceView === currentView),
      );
    const current = views[currentView];
    description.textContent = current.description;
    current.view.show(true);
  };
  const suspend = () => {
    settings.stopPreview();
    views[currentView].view.stop();
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const view = button.dataset.practiceView as ViewId;
      if (view === currentView || !Object.hasOwn(views, view)) return;
      suspend();
      views[currentView].view.show(false);
      currentView = view;
      showCurrentView();
    });
  }
  settings.onCommit(() => {
    const current: View = views[currentView].view;
    current.settingsChanged?.();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
  });
  window.addEventListener("pagehide", (event) => {
    suspend();
    if (event.persisted) return;
    for (const view of [practice, game, range, audio]) view.dispose();
    referencePlayer?.dispose();
    referencePlayer = null;
    closeAudioContext();
  });

  showCurrentView();
}

function updateBuildInfo() {
  const element = queryElement<HTMLElement>("#appVersion");
  const hash = import.meta.env.VITE_APP_COMMIT_HASH;
  element.textContent = `Version v${import.meta.env.VITE_APP_VERSION}${hash ? ` (${hash})` : ""}`;
  element.title = hash ? `build commit: ${hash}` : "build commit: unavailable";
}

init();
