import { AnimationLoop } from "./animationLoop";
import { createAudioContext } from "./audioContext";
import type { CommonSettings } from "./commonSettings";
import { queryElement } from "./dom";
import {
  getGraphTheme,
  observeGraphResize,
  resizeGraphCanvas,
} from "./graphCanvas";
import {
  formatMicrophoneError,
  type MicrophoneCapture,
  MicrophoneInput,
  PRACTICE_MIC_FFT_SIZE,
} from "./microphone";
import { VOICE_GAME_MIN_CLARITY } from "./pitchDetection";
import {
  APPROACH_MS,
  awardGameRound,
  type Challenge,
  createChallenge,
  earChoiceOffsets,
  observeChallenge,
  type PitchGameScore,
  pitchGameRank,
  randomNoteIndex,
} from "./pitchGameModel";
import {
  buildNoteRange,
  hzToCents,
  hzToMidi,
  hzToNoteName,
  midiToNoteName,
  type Note,
} from "./pitchMath";
import { ReferencePlayer } from "./referencePlayer";

type Settings = ReturnType<CommonSettings["getSettings"]>;
type Phase =
  | "idle"
  | "preparing"
  | "challenge"
  | "listen"
  | "question"
  | "feedback";

const CELEBRATION_COLORS = [
  "var(--game-success)",
  "var(--combo-tier-3)",
  "var(--blue)",
  "#ce5591",
];

export function setupGamePractice(commonSettings: CommonSettings) {
  const { getSettings, stopPreview } = commonSettings;
  const root = queryElement<HTMLElement>("#gamePracticeView");
  const elements = {
    start: queryElement<HTMLButtonElement>("#gameStart"),
    stop: queryElement<HTMLButtonElement>("#gameStop"),
    replay: queryElement<HTMLButtonElement>("#gameReplay"),
    next: queryElement<HTMLButtonElement>("#gameNext"),
    canvas: queryElement<HTMLCanvasElement>("#gameCanvas"),
    feedback: queryElement<HTMLElement>("#gameFeedback"),
    voiceGameSettings: queryElement<HTMLElement>("#voiceGameSettings"),
    earGameSettings: queryElement<HTMLElement>("#earGameSettings"),
    voiceStage: queryElement<HTMLElement>("#gameVoiceStage"),
    earStage: queryElement<HTMLElement>("#gameEarStage"),
    instructions: queryElement<HTMLElement>("#gameInstructions"),
    settings: queryElement<HTMLFieldSetElement>("#gameSettings"),
    countdown: queryElement<HTMLElement>("#gameCountdown"),
    result: queryElement<HTMLElement>("#gameResult"),
    holdProgress: queryElement<HTMLProgressElement>("#gameHoldProgress"),
    history: queryElement<HTMLElement>("#gameHistory"),
    target: queryElement<HTMLElement>("#gameTarget"),
    voice: queryElement<HTMLElement>("#gameVoice"),
    gap: queryElement<HTMLElement>("#gameGap"),
    choices: queryElement<HTMLElement>("#gameChoices"),
    metric: queryElement<HTMLElement>("#gameMetric"),
    setup: queryElement<HTMLDialogElement>("#gameSetup"),
    openSettings: queryElement<HTMLButtonElement>("#openGameSettings"),
    settingsSummary: queryElement<HTMLElement>("#gameSettingsSummary"),
    score: queryElement<HTMLElement>("#gameScore"),
    points: queryElement<HTMLElement>("#gamePoints"),
    streak: queryElement<HTMLElement>("#gameStreak"),
    best: queryElement<HTMLElement>("#gameBest"),
    roundProgress: queryElement<HTMLProgressElement>("#gameRoundProgress"),
    effectSound: queryElement<HTMLInputElement>("#gameEffectSound"),
    celebration: queryElement<HTMLElement>("#gameCelebration"),
  };
  const options = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );
  let active = false;
  let audioReady = false;
  let runGeneration = 0;
  let audioContext: AudioContext | null = null;
  let referencePlayer: ReferencePlayer | null = null;
  const microphone = new MicrophoneInput();
  const earLoop = new AnimationLoop();
  let phase: Phase = "idle";
  let mode = "voice";
  let settings: Settings | null = null;
  let notes: Note[] = [];
  let choices: Note[] = [];
  let target: Note | null = null;
  let previousIndex: number | null = null;
  let challenge: Challenge | null = null;
  let until = 0;
  let round = 0;
  let rounds = 5;
  let correct = 0;
  let score: PitchGameScore = { points: 0, streak: 0, bestStreak: 0 };
  let best = 0;
  let bestKey = "";
  let effectTimer: ReturnType<typeof setTimeout> | null = null;
  let trace: { time: number; hz: number | null }[] = [];

  elements.start.addEventListener("click", () => void start());
  elements.stop.addEventListener("click", () => stop());
  elements.replay.addEventListener("click", () => {
    if (phase === "question") playQuestion();
  });
  elements.next.addEventListener("click", () => {
    if (phase !== "feedback") return;
    if (round >= rounds) finish();
    else nextEarRound();
  });
  commonSettings.setupTabbedDialog(elements.setup, elements.openSettings);
  elements.settings.addEventListener("change", (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === "radio"
    )
      showMode();
  });
  const stopObservingGraph = observeGraphResize([elements.canvas], draw);
  showMode();

  return { show, stop, settingsChanged, dispose };

  function message(text: string) {
    elements.feedback.textContent = text;
  }

  function selected(name: string): string {
    const input = options.find(
      (option) => option.name === name && option.checked,
    );
    if (!input) throw new Error(`ゲームの設定が選択されていません：${name}`);
    return input.value;
  }

  function showMode() {
    const voice = selected("gameMode") === "voice";
    elements.voiceGameSettings.hidden = !voice;
    elements.earGameSettings.hidden = voice;
    elements.voiceStage.hidden = !voice;
    elements.earStage.hidden = voice;
    const condition = voice
      ? `${selected("voiceGameHold")}秒キープ`
      : selected("earGameDifficulty") === "3"
        ? "やさしい"
        : "むずかしい";
    elements.settingsSummary.textContent = `${voice ? "発声チャレンジ" : "音当て"}・${selected("gameRounds")}問・${condition}`;
    elements.instructions.textContent = voice
      ? `目標がランダムに変わります。${APPROACH_MS / 1000}秒以内に音を合わせ、その後は指定秒数ずっとキープ。お手本音は鳴らさず、画面を見て挑戦します。`
      : "鳴った音を選択肢から当てます。最初は3半音間隔、上級は半音間隔。何度でも聴き直せます。マイクは使いません。";
    draw();
  }

  function show(visible: boolean) {
    if (!visible) elements.setup.close();
    root.hidden = !visible;
    if (visible) requestAnimationFrame(draw);
  }

  function settingsChanged() {
    if (active)
      stop("共通設定が変わったため中止しました。新しい設定で再開できます。");
  }

  function dispose() {
    elements.setup.close();
    stop();
    stopObservingGraph();
  }

  function stop(reason = "ゲームを中止しました。最初からやり直せます。") {
    const wasActive = active;
    active = false;
    audioReady = false;
    runGeneration += 1;
    phase = "idle";
    earLoop.stop();
    clearCelebration();
    referencePlayer?.dispose();
    microphone.stop();
    if (audioContext && audioContext.state !== "closed")
      void audioContext.close().catch(() => {});
    referencePlayer = null;
    audioContext = null;
    elements.start.disabled = false;
    elements.stop.disabled = true;
    elements.settings.disabled = false;
    elements.openSettings.disabled = false;
    elements.replay.disabled = true;
    elements.next.hidden = true;
    elements.countdown.hidden = true;
    root.classList.remove("game-success", "game-holding");
    setChoicesDisabled(true);
    if (wasActive) message(reason);
  }

  async function start() {
    stop();
    const generation = runGeneration;
    active = true;
    mode = selected("gameMode");
    phase = "preparing";
    round = correct = 0;
    score = { points: 0, streak: 0, bestStreak: 0 };
    best = 0;
    elements.result.hidden = true;
    elements.start.textContent = "ゲームを始める";
    elements.holdProgress.value = 0;
    previousIndex = null;
    target = null;
    trace = [];
    rounds = Number(selected("gameRounds"));
    elements.history.replaceChildren();
    elements.target.textContent = "—";
    elements.voice.textContent = "—";
    elements.gap.textContent = "—";
    elements.choices.replaceChildren();
    elements.metric.textContent = "—";
    elements.start.disabled = true;
    elements.stop.disabled = false;
    elements.settings.disabled = true;
    elements.setup.close();
    elements.openSettings.disabled = true;
    updateScore();
    let startingMicrophone = false;
    try {
      stopPreview();
      settings = getSettings();
      bestKey = `pitch-games:v1:${JSON.stringify([
        mode,
        rounds,
        settings.startMidi,
        settings.tolerance,
        settings.minRms,
        mode === "voice"
          ? selected("voiceGameHold")
          : selected("earGameDifficulty"),
        mode === "ear" ? settings.instrument : null,
        ...(mode === "voice" ? [APPROACH_MS] : []),
      ])}`;
      try {
        const stored = Number(localStorage.getItem(bestKey));
        best = Number.isFinite(stored) && stored >= 0 ? stored : 0;
      } catch {
        /* Keep playing when browser storage is unavailable. */
      }
      updateScore();
      notes = buildNoteRange(settings.startMidi);
      if (mode === "ear" && settings.volume === 0)
        throw new Error("共通設定のお手本音量を上げてから始めてください。");
      audioContext = createAudioContext();
      const context = audioContext;
      await context.resume();
      if (generation !== runGeneration) return;
      context.addEventListener("statechange", () => {
        if (
          generation === runGeneration &&
          audioReady &&
          context.state !== "running"
        )
          stop("音声処理が中断されました。再度開始してください。");
      });
      referencePlayer = new ReferencePlayer(context);
      referencePlayer.setVolume(settings.volume);
      if (mode === "ear") {
        message("お手本の音色を準備しています。");
        const player = referencePlayer;
        await player.prepare(settings.instrument);
        if (generation !== runGeneration) return;
        const step = Number(selected("earGameDifficulty")) === 3 ? 3 : 1;
        choices = earChoiceOffsets(step).map((offset) => notes[offset]);
        elements.choices.replaceChildren(
          ...choices.map((note, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${note.solfege} (${note.name})`;
            button.addEventListener("click", () => answer(index));
            return button;
          }),
        );
        nextEarRound();
      } else {
        startingMicrophone = true;
        message("マイクの使用を許可してください。");
        const capture = await microphone.start(() => context, {
          deviceId: settings.deviceId,
          fftSize: PRACTICE_MIC_FFT_SIZE,
          onEnded: () => stop("マイクが切断されました。"),
          onFrame: (_, input) => tick(input),
        });
        if (!capture || generation !== runGeneration) return;
        until = context.currentTime * 1000 + 3000;
        elements.countdown.hidden = false;
        message("3秒後に最初の目標が現れます。画面を見て準備してください。");
      }
      await context.resume();
      if (generation !== runGeneration) return;
      audioReady = true;
      if (mode === "ear") earLoop.start(() => tick());
      elements.feedback.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    } catch (error) {
      if (generation !== runGeneration) return;
      stop(
        startingMicrophone
          ? formatMicrophoneError(error)
          : `開始できませんでした：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function nextVoiceRound(now: number) {
    if (!settings) return;
    if (round >= rounds) {
      finish();
      return;
    }
    const index = randomNoteIndex(notes.length, previousIndex);
    previousIndex = index;
    target = notes[index];
    round++;
    phase = "challenge";
    trace = [];
    elements.holdProgress.value = 0;
    root.classList.remove("game-holding");
    challenge = createChallenge(
      target.frequency,
      now,
      Number(selected("voiceGameHold")) * 1000,
    );
    elements.target.textContent = `${target.solfege} (${target.name})`;
    elements.countdown.hidden = true;
    root.classList.remove("game-success");
    message(
      `第${round}問：${APPROACH_MS / 1000}秒以内に${target.solfege}へ合わせてください。`,
    );
    updateScore();
  }

  function nextEarRound() {
    clearCelebration();
    const index = randomNoteIndex(choices.length, previousIndex);
    previousIndex = index;
    target = choices[index];
    round++;
    root.classList.remove("game-success");
    elements.next.hidden = true;
    for (const button of elements.choices.querySelectorAll("button"))
      button.removeAttribute("data-result");
    updateScore();
    playQuestion();
  }

  function playQuestion() {
    if (!audioContext || !referencePlayer || !settings || !target) return;
    const at = audioContext.currentTime + 0.05;
    referencePlayer.playScale(settings.instrument, [target.frequency], {
      startAt: at,
      noteSeconds: 0.8,
    });
    until = (at + 0.9) * 1000;
    phase = "listen";
    setChoicesDisabled(true);
    elements.replay.disabled = true;
    message(`第${round}問：音を聴いてください。`);
  }

  function setChoicesDisabled(disabled: boolean) {
    for (const button of elements.choices.querySelectorAll("button"))
      button.disabled = disabled;
  }

  function answer(index: number) {
    if (phase !== "question" || !target) return;
    phase = "feedback";
    const correct = choices[index] === target;
    reward(correct);
    root.classList.toggle("game-success", correct);
    setChoicesDisabled(true);
    const buttons = elements.choices.querySelectorAll("button");
    buttons[index].dataset.result = correct ? "correct" : "incorrect";
    buttons[choices.indexOf(target)].dataset.result = "correct";
    const result = `${correct ? "正解！" : "今回は違いました。"} 正解は${target.solfege} (${target.name})です。`;
    message(result);
    addHistory(result);
    elements.replay.disabled = true;
    elements.next.textContent = round === rounds ? "結果を見る" : "次の問題";
    elements.next.hidden = false;
    updateScore();
  }

  function tick(capture?: MicrophoneCapture) {
    if (!audioReady || !audioContext) return;
    const now = audioContext.currentTime * 1000;
    if (mode === "ear") {
      if (phase === "listen" && now >= until) {
        phase = "question";
        setChoicesDisabled(false);
        elements.replay.disabled = false;
        message("どの音でしたか？ 選択肢から選んでください。");
      }
    } else {
      if (phase === "preparing") {
        elements.countdown.textContent = `開始まで ${Math.max(1, Math.ceil((until - now) / 1000))}`;
        if (now >= until) nextVoiceRound(now);
      } else if (phase === "feedback" && now >= until) nextVoiceRound(now);
      if (phase === "challenge" && challenge && target && capture && settings) {
        const detection = capture.sampleTarget({
          minRms: settings.minRms,
          minClarity: VOICE_GAME_MIN_CLARITY,
          targetFrequency: target.frequency,
        });
        const previous = challenge;
        challenge = observeChallenge(
          previous,
          now,
          detection.frequency,
          settings.tolerance,
        );
        elements.voice.textContent = detection.frequency
          ? `${hzToNoteName(detection.frequency)} / ${detection.frequency.toFixed(1)} Hz`
          : "検出できません";
        elements.gap.textContent = detection.frequency
          ? `${Math.round(hzToCents(detection.frequency, target.frequency))} cents`
          : "—";
        const approaching = challenge.phase === "approach";
        const remaining = Math.max(
          0,
          APPROACH_MS - (now - challenge.startedAt),
        );
        elements.metric.textContent = approaching
          ? `音に合わせるまで あと${(remaining / 1000).toFixed(1)}秒`
          : `キープ ${(challenge.heldMs / 1000).toFixed(1)} / ${(challenge.holdMs / 1000).toFixed(1)}秒`;
        const progress = elements.holdProgress;
        progress.max = approaching ? APPROACH_MS : challenge.holdMs;
        progress.value = approaching ? remaining : challenge.heldMs;
        progress.setAttribute(
          "aria-label",
          approaching ? "音を合わせるまでの残り時間" : "連続キープの進み具合",
        );
        if (!trace.length || now - trace[trace.length - 1].time >= 40)
          trace.push({ time: now, hz: detection.frequency });
        trace = trace.filter((point) => now - point.time <= 5000);
        root.classList.toggle("game-holding", challenge.phase === "hold");
        if (previous.phase === "approach" && challenge.phase === "hold") {
          message("合っています。そのままキープ！");
          celebrate("ぴったり！", false);
        }
        if (challenge.phase === "success" || challenge.phase === "failure") {
          const success = challenge.phase === "success";
          reward(success);
          const result = success
            ? "成功！ 指定時間キープできました。"
            : previous.phase === "approach"
              ? `時間切れ。${APPROACH_MS / 1000}秒以内に合わせられませんでした。`
              : "キープが途切れました。";
          message(`${result} 次の目標を準備します。`);
          addHistory(`${target.solfege} (${target.name})：${result}`);
          root.classList.toggle("game-success", success);
          phase = "feedback";
          until = now + 1500;
          updateScore();
        }
        draw();
      }
    }
  }

  function updateScore() {
    elements.score.textContent = `${round} / ${rounds}問 ・ ${correct}問成功`;
    elements.points.textContent = `${score.points} pt`;
    elements.streak.textContent = `${score.streak}連続`;
    elements.best.textContent = `${best} pt`;
    const progress = elements.roundProgress;
    progress.max = rounds;
    progress.value = elements.history.children.length;
  }

  function reward(success: boolean) {
    if (success) correct++;
    const previousPoints = score.points;
    score = awardGameRound(score, success);
    if (!success) {
      clearCelebration();
      return;
    }
    const bonus = score.points - previousPoints;
    celebrate(
      `${score.streak >= 2 ? `${score.streak}連続！ ` : "やった！ "}+${bonus} pt`,
      true,
    );
    if (elements.effectSound.checked) {
      referencePlayer?.playScale("sine", [659.25, 880, 1046.5], {
        noteSeconds: 0.2,
      });
    }
  }

  function clearCelebration() {
    if (effectTimer) clearTimeout(effectTimer);
    effectTimer = null;
    elements.celebration.replaceChildren();
  }

  function celebrate(label: string, burst: boolean) {
    if (effectTimer) clearTimeout(effectTimer);
    const particles: HTMLElement[] = [];
    const banner = document.createElement("span");
    banner.className = "game-burst-label";
    banner.textContent = label;
    particles.push(banner);
    if (burst) {
      for (let i = 0; i < 18; i++) {
        const particle = document.createElement("span");
        particle.className = "game-particle";
        const angle = (i * Math.PI * 2) / 18;
        particle.style.setProperty(
          "--dx",
          `${Math.cos(angle) * (70 + (i % 3) * 25)}px`,
        );
        particle.style.setProperty("--dy", `${Math.sin(angle) * 65 - 20}px`);
        particle.style.setProperty("--turn", `${i * 53}deg`);
        particle.style.background =
          CELEBRATION_COLORS[i % CELEBRATION_COLORS.length];
        particles.push(particle);
      }
    }
    elements.celebration.replaceChildren(...particles);
    effectTimer = setTimeout(
      () => elements.celebration.replaceChildren(),
      1200,
    );
  }

  function addHistory(text: string) {
    const item = document.createElement("li");
    item.textContent = `${round}問目：${text}`;
    elements.history.append(item);
  }

  function finish() {
    const newBest = score.points > best;
    if (newBest) {
      best = score.points;
      try {
        localStorage.setItem(bestKey, String(best));
      } catch {
        /* Best remains visible for this session. */
      }
    }
    const result = elements.result;
    const rank = document.createElement("strong");
    rank.className = "game-rank";
    rank.textContent = pitchGameRank(correct, rounds);
    const title = document.createElement("h3");
    title.textContent = newBest
      ? "自己ベスト更新！"
      : correct === rounds
        ? "全問成功！"
        : "ナイスチャレンジ！";
    const detail = document.createElement("p");
    detail.textContent = `${score.points} pt ・ 最大${score.bestStreak}連続成功。${correct < rounds ? "次はもう1問成功をめざそう。" : "難易度や音域を変えて挑戦してみよう。"}`;
    result.replaceChildren(rank, title, detail);
    result.hidden = false;
    stop(
      `終了！ ${rounds}問中${correct}問成功しました。下の結果で振り返れます。`,
    );
    elements.start.textContent = "もう一度挑戦";
    updateScore();
    result.scrollIntoView({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  function draw() {
    const canvas = elements.canvas;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const { pixelRatio } = resizeGraphCanvas(canvas, width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const theme = getGraphTheme();
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    const startMidi = settings?.startMidi ?? getSettings().startMidi;
    const y = (midi: number) => 240 - ((midi - startMidi) / 12) * 220;
    ctx.font = "12px system-ui";
    for (let i = 0; i <= 12; i++) {
      const at = y(startMidi + i);
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, at);
      ctx.lineTo(width, at);
      ctx.stroke();
      ctx.fillStyle = theme.label;
      ctx.fillText(midiToNoteName(startMidi + i), 3, at + 4);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(40, 0, width - 40, 260);
    ctx.clip();
    if (target) {
      const at = y(hzToMidi(target.frequency));
      ctx.strokeStyle = theme.target;
      ctx.lineWidth = challenge?.phase === "hold" ? 8 : 6;
      if (challenge?.phase === "hold") {
        ctx.shadowColor = theme.gameSuccess;
        ctx.shadowBlur = 18;
      }
      ctx.beginPath();
      ctx.moveTo(42, at);
      ctx.lineTo(width - 6, at);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = theme.voice;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const latest = trace.at(-1)?.time ?? 0;
    let previous: { time: number; hz: number | null } | null = null;
    for (const point of trace) {
      if (!point.hz) {
        previous = null;
        continue;
      }
      const x = 42 + (1 - (latest - point.time) / 5000) * (width - 50);
      const at = y(hzToMidi(point.hz));
      if (!previous || point.time - previous.time > 250) ctx.moveTo(x, at);
      else ctx.lineTo(x, at);
      previous = point;
    }
    ctx.stroke();
    ctx.restore();
  }
}
