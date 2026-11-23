import { closeAudioContext } from "./audioContext";
import { setupAudioFileView } from "./audioFileView";
import { queryElement } from "./dom";
import { GamePractice } from "./gamePractice";
import { setupPracticeView } from "./practiceView";
import { setupPwa } from "./pwa";
import { VoiceRangeCheck } from "./voiceRangeCheck";
import "../styles.css";

type View = {
  description: string;
  show(visible: boolean): void;
  stop(): void;
  settingsChanged?(): void;
  dispose?(): void;
};

function init() {
  setupPwa();
  updateBuildInfo();

  const practice = setupPracticeView(() => views[currentView].stop());
  const audio = setupAudioFileView();
  const game = new GamePractice(practice.getSettings, practice.stopPreview);
  const range = new VoiceRangeCheck(practice.getSettings, practice.stopPreview);
  const gameRoot = queryElement<HTMLElement>("#gamePracticeView");
  const rangeRoot = queryElement<HTMLElement>("#voiceRangeView");
  const views = {
    single: {
      description: "音をひとつ選び、お手本に合わせて声を伸ばします。",
      show: (visible) => practice.show(visible ? "single" : null),
      stop: practice.stop,
    },
    melody: {
      description:
        "お手本と一緒に歌い、停止するまで繰り返します。停止後に音ごとに振り返れます。",
      show: (visible) => practice.show(visible ? "melody" : null),
      stop: practice.stop,
    },
    games: {
      description:
        "ランダムな目標音への発声と、鳴った音を当てるゲームに挑戦できます。",
      show: (visible) => {
        gameRoot.hidden = !visible;
      },
      stop: () => game.stop(),
      settingsChanged: () => game.settingsChanged(),
      dispose: () => game.dispose(),
    },
    range: {
      description:
        "マイクで自分の声域をチェックします。安定して出せた音を3通りの表記で確認できます。",
      show: (visible) => {
        rangeRoot.hidden = !visible;
      },
      stop: () => range.stop(),
      settingsChanged: () => range.stop(),
      dispose: () => range.dispose(),
    },
    audio: {
      description: "音源や動画を読み込み、歌声の高さの目安を確認します。",
      show: audio.show,
      stop: audio.pause,
      dispose: audio.dispose,
    },
  } satisfies Record<string, View>;
  type ViewId = keyof typeof views;
  let currentView: ViewId = "single";
  const description = queryElement<HTMLElement>("#practiceViewDescription");
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    "[data-practice-view]",
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
    current.show(true);
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const view = button.dataset.practiceView as ViewId;
      if (view === currentView || !Object.hasOwn(views, view)) return;
      practice.stopPreview();
      const previous = views[currentView];
      previous.stop();
      previous.show(false);
      currentView = view;
      showCurrentView();
    });
  }
  practice.settingsDialog.addEventListener("change", () => {
    const current: View = views[currentView];
    current.settingsChanged?.();
  });

  const suspend = () => {
    practice.stopPreview();
    views[currentView].stop();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
  });
  window.addEventListener("pagehide", (event) => {
    suspend();
    if (event.persisted) return;
    practice.dispose();
    for (const view of Object.values<View>(views)) view.dispose?.();
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
