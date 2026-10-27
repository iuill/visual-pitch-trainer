import { PitchDetector } from "pitchy";
import {
  detectPitchWithLibraries,
  type LibraryDetectors,
} from "./pitchDetection";
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
import type { ReferenceInstrumentId } from "./referenceInstruments";
import { ReferencePlayer } from "./referencePlayer";

type Settings = {
  startMidi: number;
  instrument: ReferenceInstrumentId;
  volume: number;
  deviceId: string;
  minRms: number;
  tolerance: number;
};
type Phase =
  | "idle"
  | "preparing"
  | "challenge"
  | "listen"
  | "question"
  | "feedback";

export class GamePractice {
  private readonly root: HTMLElement;
  private active = false;
  private audioReady = false;
  private generation = 0;
  private context: AudioContext | null = null;
  private player: ReferencePlayer | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = new Float32Array(4096);
  private detectors: LibraryDetectors | null = null;
  private frame: number | null = null;
  private phase: Phase = "idle";
  private mode = "voice";
  private settings: Settings | null = null;
  private notes: Note[] = [];
  private choices: Note[] = [];
  private target: Note | null = null;
  private previousIndex: number | null = null;
  private challenge: Challenge | null = null;
  private until = 0;
  private round = 0;
  private rounds = 5;
  private correct = 0;
  private score: PitchGameScore = { points: 0, streak: 0, bestStreak: 0 };
  private best = 0;
  private bestKey = "";
  private effectTimer: ReturnType<typeof setTimeout> | null = null;
  private trace: { time: number; hz: number | null }[] = [];

  constructor(
    private readonly getSettings: () => Settings,
    private readonly beforeStart: () => void,
  ) {
    const root = document.querySelector<HTMLElement>("#gamePracticeView");
    if (!root) throw new Error("ゲーム画面がありません。");
    this.root = root;
    this.el<HTMLButtonElement>("gameStart").addEventListener(
      "click",
      () => void this.start(),
    );
    this.el<HTMLButtonElement>("gameStop").addEventListener("click", () =>
      this.stop(),
    );
    this.el<HTMLButtonElement>("gameReplay").addEventListener("click", () => {
      if (this.phase === "question") this.playQuestion();
    });
    this.el<HTMLButtonElement>("gameNext").addEventListener("click", () => {
      if (this.phase !== "feedback") return;
      if (this.round >= this.rounds) this.finish();
      else this.nextEarRound();
    });
    this.el<HTMLSelectElement>("gameMode").addEventListener("change", () =>
      this.showMode(),
    );
    new ResizeObserver(() => this.draw()).observe(this.el("gameCanvas"));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
    });
    window.addEventListener("pagehide", () => this.stop());
    this.showMode();
  }
  private el<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`ゲームの要素がありません：${id}`);
    return element;
  }
  private message(text: string) {
    this.el("gameFeedback").textContent = text;
  }
  private showMode() {
    const voice = this.el<HTMLSelectElement>("gameMode").value === "voice";
    this.el("voiceGameSettings").hidden = !voice;
    this.el("earGameSettings").hidden = voice;
    this.el("gameVoiceStage").hidden = !voice;
    this.el("gameEarStage").hidden = voice;
    this.el("gameInstructions").textContent = voice
      ? "目標がランダムに変わります。1秒以内に音を合わせ、その後は指定秒数ずっとキープ。お手本音は鳴らさず、画面を見て挑戦します。"
      : "鳴った音を選択肢から当てます。最初は3半音間隔、上級は半音間隔。何度でも聴き直せます。マイクは使いません。";
    this.draw();
  }
  settingsChanged() {
    if (this.active)
      this.stop(
        "共通設定が変わったため中止しました。新しい設定で再開できます。",
      );
  }
  stop(message = "ゲームを中止しました。最初からやり直せます。") {
    const wasActive = this.active;
    this.active = false;
    this.audioReady = false;
    ++this.generation;
    this.phase = "idle";
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.clearCelebration();
    this.player?.dispose();
    this.source?.disconnect();
    this.analyser?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.player = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.detectors = null;
    this.el<HTMLButtonElement>("gameStart").disabled = false;
    this.el<HTMLButtonElement>("gameStop").disabled = true;
    this.el<HTMLFieldSetElement>("gameSettings").disabled = false;
    this.el<HTMLButtonElement>("gameReplay").disabled = true;
    this.el("gameNext").hidden = true;
    this.el("gameCountdown").hidden = true;
    this.root.classList.remove("game-success", "game-holding");
    this.setChoicesDisabled(true);
    if (wasActive) this.message(message);
  }
  private async start() {
    this.stop();
    const generation = this.generation;
    this.active = true;
    this.mode = this.el<HTMLSelectElement>("gameMode").value;
    this.phase = "preparing";
    this.round = this.correct = 0;
    this.score = { points: 0, streak: 0, bestStreak: 0 };
    this.best = 0;
    this.el("gameResult").hidden = true;
    this.el<HTMLButtonElement>("gameStart").textContent = "ゲームを始める";
    this.el<HTMLProgressElement>("gameHoldProgress").value = 0;
    this.previousIndex = null;
    this.target = null;
    this.trace = [];
    this.rounds = Number(this.el<HTMLSelectElement>("gameRounds").value);
    this.el("gameHistory").replaceChildren();
    this.el("gameTarget").textContent = "—";
    this.el("gameVoice").textContent = "—";
    this.el("gameGap").textContent = "—";
    this.el("gameChoices").replaceChildren();
    this.el("gameMetric").textContent = "—";
    this.el<HTMLButtonElement>("gameStart").disabled = true;
    this.el<HTMLButtonElement>("gameStop").disabled = false;
    this.el<HTMLFieldSetElement>("gameSettings").disabled = true;
    this.el<HTMLDetailsElement>("gameSetup").open = false;
    this.updateScore();
    try {
      this.beforeStart();
      this.settings = this.getSettings();
      this.bestKey = `pitch-games:v1:${JSON.stringify([
        this.mode,
        this.rounds,
        this.settings.startMidi,
        this.settings.tolerance,
        this.settings.minRms,
        this.mode === "voice"
          ? this.el<HTMLSelectElement>("voiceGameHold").value
          : this.el<HTMLSelectElement>("earGameDifficulty").value,
        this.mode === "ear" ? this.settings.instrument : null,
      ])}`;
      try {
        const stored = Number(localStorage.getItem(this.bestKey));
        this.best = Number.isFinite(stored) && stored >= 0 ? stored : 0;
      } catch {
        /* Keep playing when browser storage is unavailable. */
      }
      this.updateScore();
      this.notes = buildNoteRange(this.settings.startMidi);
      if (this.mode === "ear" && this.settings.volume === 0)
        throw new Error("共通設定のお手本音量を上げてから始めてください。");
      this.context = new AudioContext();
      const context = this.context;
      await context.resume();
      if (generation !== this.generation) return;
      context.addEventListener("statechange", () => {
        if (
          generation === this.generation &&
          this.audioReady &&
          context.state !== "running"
        )
          this.stop("音声処理が中断されました。再度開始してください。");
      });
      this.player = new ReferencePlayer(context);
      this.player.setVolume(this.settings.volume);
      if (this.mode === "ear") {
        this.message("お手本の音色を準備しています。");
        const player = this.player;
        await player.prepare(this.settings.instrument);
        if (generation !== this.generation) return;
        const step =
          Number(this.el<HTMLSelectElement>("earGameDifficulty").value) === 3
            ? 3
            : 1;
        this.choices = earChoiceOffsets(step).map(
          (offset) => this.notes[offset],
        );
        this.el("gameChoices").replaceChildren(
          ...this.choices.map((note, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${note.solfege} (${note.name})`;
            button.addEventListener("click", () => this.answer(index));
            return button;
          }),
        );
        this.nextEarRound();
      } else {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("マイクにはHTTPSまたはlocalhostが必要です。");
        this.message("マイクの使用を許可してください。");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(this.settings.deviceId
              ? { deviceId: { exact: this.settings.deviceId } }
              : {}),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (generation !== this.generation) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        this.stream = stream;
        for (const track of stream.getAudioTracks())
          track.addEventListener("ended", () => {
            if (generation === this.generation)
              this.stop("マイクが切断されました。");
          });
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = this.buffer.length;
        this.source = context.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        const detector = PitchDetector.forFloat32Array(this.buffer.length);
        detector.clarityThreshold = 0.93;
        this.detectors = {
          detector,
          sampleRate: context.sampleRate,
          bufferSize: this.buffer.length,
        };
        this.until = context.currentTime * 1000 + 3000;
        this.el("gameCountdown").hidden = false;
        this.message(
          "3秒後に最初の目標が現れます。画面を見て準備してください。",
        );
      }
      await context.resume();
      if (generation !== this.generation) return;
      this.audioReady = true;
      this.tick();
      this.el("gameFeedback").scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop(
        `開始できませんでした：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  private nextVoiceRound(now: number) {
    if (!this.settings) return;
    if (this.round >= this.rounds) {
      this.finish();
      return;
    }
    const index = randomNoteIndex(this.notes.length, this.previousIndex);
    this.previousIndex = index;
    this.target = this.notes[index];
    this.round++;
    this.phase = "challenge";
    this.trace = [];
    this.el<HTMLProgressElement>("gameHoldProgress").value = 0;
    this.root.classList.remove("game-holding");
    this.challenge = createChallenge(
      this.target.frequency,
      now,
      Number(this.el<HTMLSelectElement>("voiceGameHold").value) * 1000,
    );
    this.el("gameTarget").textContent =
      `${this.target.solfege} (${this.target.name})`;
    this.el("gameCountdown").hidden = true;
    this.root.classList.remove("game-success");
    this.message(
      `第${this.round}問：1秒以内に${this.target.solfege}へ合わせてください。`,
    );
    this.updateScore();
  }
  private nextEarRound() {
    this.clearCelebration();
    const index = randomNoteIndex(this.choices.length, this.previousIndex);
    this.previousIndex = index;
    this.target = this.choices[index];
    this.round++;
    this.root.classList.remove("game-success");
    this.el("gameNext").hidden = true;
    for (const button of this.el("gameChoices").querySelectorAll("button"))
      button.removeAttribute("data-result");
    this.updateScore();
    this.playQuestion();
  }
  private playQuestion() {
    if (!this.context || !this.player || !this.settings || !this.target) return;
    const at = this.context.currentTime + 0.05;
    this.player.playScale(this.settings.instrument, [this.target.frequency], {
      startAt: at,
      noteSeconds: 0.8,
    });
    this.until = (at + 0.9) * 1000;
    this.phase = "listen";
    this.setChoicesDisabled(true);
    this.el<HTMLButtonElement>("gameReplay").disabled = true;
    this.message(`第${this.round}問：音を聴いてください。`);
  }
  private setChoicesDisabled(disabled: boolean) {
    for (const button of this.el("gameChoices").querySelectorAll("button"))
      button.disabled = disabled;
  }
  private answer(index: number) {
    if (this.phase !== "question" || !this.target) return;
    this.phase = "feedback";
    const correct = this.choices[index] === this.target;
    this.reward(correct);
    this.root.classList.toggle("game-success", correct);
    this.setChoicesDisabled(true);
    const buttons = this.el("gameChoices").querySelectorAll("button");
    buttons[index].dataset.result = correct ? "correct" : "incorrect";
    buttons[this.choices.indexOf(this.target)].dataset.result = "correct";
    const result = `${correct ? "正解！" : "今回は違いました。"} 正解は${this.target.solfege} (${this.target.name})です。`;
    this.message(result);
    this.addHistory(result);
    this.el<HTMLButtonElement>("gameReplay").disabled = true;
    this.el<HTMLButtonElement>("gameNext").textContent =
      this.round === this.rounds ? "結果を見る" : "次の問題";
    this.el("gameNext").hidden = false;
    this.updateScore();
  }
  private tick = () => {
    if (!this.active || !this.context) return;
    const now = this.context.currentTime * 1000;
    if (this.mode === "ear") {
      if (this.phase === "listen" && now >= this.until) {
        this.phase = "question";
        this.setChoicesDisabled(false);
        this.el<HTMLButtonElement>("gameReplay").disabled = false;
        this.message("どの音でしたか？ 選択肢から選んでください。");
      }
    } else {
      if (this.phase === "preparing") {
        this.el("gameCountdown").textContent =
          `開始まで ${Math.max(1, Math.ceil((this.until - now) / 1000))}`;
        if (now >= this.until) this.nextVoiceRound(now);
      } else if (this.phase === "feedback" && now >= this.until)
        this.nextVoiceRound(now);
      if (
        this.phase === "challenge" &&
        this.challenge &&
        this.target &&
        this.analyser &&
        this.detectors &&
        this.settings
      ) {
        this.analyser.getFloatTimeDomainData(this.buffer);
        const detection = detectPitchWithLibraries(
          this.buffer,
          this.detectors,
          {
            minRms: this.settings.minRms,
            minClarity: 0.9,
            targetFrequency: this.target.frequency,
          },
        );
        const previous = this.challenge;
        this.challenge = observeChallenge(
          previous,
          now,
          detection.frequency,
          this.settings.tolerance,
        );
        this.el("gameVoice").textContent = detection.frequency
          ? `${hzToNoteName(detection.frequency)} / ${detection.frequency.toFixed(1)} Hz`
          : "検出できません";
        this.el("gameGap").textContent = detection.frequency
          ? `${Math.round(hzToCents(detection.frequency, this.target.frequency))} cents`
          : "—";
        const approaching = this.challenge.phase === "approach";
        const remaining = Math.max(
          0,
          APPROACH_MS - (now - this.challenge.startedAt),
        );
        this.el("gameMetric").textContent = approaching
          ? `音に合わせるまで あと${(remaining / 1000).toFixed(1)}秒`
          : `キープ ${(this.challenge.heldMs / 1000).toFixed(1)} / ${(this.challenge.holdMs / 1000).toFixed(1)}秒`;
        const progress = this.el<HTMLProgressElement>("gameHoldProgress");
        progress.max = approaching ? APPROACH_MS : this.challenge.holdMs;
        progress.value = approaching ? remaining : this.challenge.heldMs;
        progress.setAttribute(
          "aria-label",
          approaching ? "音を合わせるまでの残り時間" : "連続キープの進み具合",
        );
        if (
          !this.trace.length ||
          now - this.trace[this.trace.length - 1].time >= 40
        )
          this.trace.push({ time: now, hz: detection.frequency });
        this.trace = this.trace.filter((point) => now - point.time <= 5000);
        this.root.classList.toggle(
          "game-holding",
          this.challenge.phase === "hold",
        );
        if (previous.phase === "approach" && this.challenge.phase === "hold") {
          this.message("合っています。そのままキープ！");
          this.celebrate("ぴったり！", false);
        }
        if (
          this.challenge.phase === "success" ||
          this.challenge.phase === "failure"
        ) {
          const success = this.challenge.phase === "success";
          this.reward(success);
          const result = success
            ? "成功！ 指定時間キープできました。"
            : previous.phase === "approach"
              ? "時間切れ。1秒以内に合わせられませんでした。"
              : "キープが途切れました。";
          this.message(`${result} 次の目標を準備します。`);
          this.addHistory(
            `${this.target.solfege} (${this.target.name})：${result}`,
          );
          this.root.classList.toggle("game-success", success);
          this.phase = "feedback";
          this.until = now + 1500;
          this.updateScore();
        }
        this.draw();
      }
    }
    if (this.active) this.frame = requestAnimationFrame(this.tick);
  };
  private updateScore() {
    this.el("gameScore").textContent =
      `${this.round} / ${this.rounds}問 ・ ${this.correct}問成功`;
    this.el("gamePoints").textContent = `${this.score.points} pt`;
    this.el("gameStreak").textContent = `${this.score.streak}連続`;
    this.el("gameBest").textContent = `${this.best} pt`;
    const progress = this.el<HTMLProgressElement>("gameRoundProgress");
    progress.max = this.rounds;
    progress.value = this.el("gameHistory").children.length;
  }
  private reward(success: boolean) {
    if (success) this.correct++;
    const previousPoints = this.score.points;
    this.score = awardGameRound(this.score, success);
    if (!success) {
      this.clearCelebration();
      return;
    }
    const bonus = this.score.points - previousPoints;
    this.celebrate(
      `${this.score.streak >= 2 ? `${this.score.streak}連続！ ` : "やった！ "}+${bonus} pt`,
      true,
    );
    if (this.el<HTMLInputElement>("gameEffectSound").checked) {
      this.player?.playScale("sine", [659.25, 880, 1046.5], {
        noteSeconds: 0.2,
      });
    }
  }
  private clearCelebration() {
    if (this.effectTimer) clearTimeout(this.effectTimer);
    this.effectTimer = null;
    this.el("gameCelebration").replaceChildren();
  }
  private celebrate(label: string, burst: boolean) {
    if (this.effectTimer) clearTimeout(this.effectTimer);
    const elements: HTMLElement[] = [];
    const banner = document.createElement("span");
    banner.className = "game-burst-label";
    banner.textContent = label;
    elements.push(banner);
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
        particle.style.background = [
          "#15806d",
          "#e09f10",
          "#2b6cb0",
          "#ce5591",
        ][i % 4];
        elements.push(particle);
      }
    }
    this.el("gameCelebration").replaceChildren(...elements);
    this.effectTimer = setTimeout(
      () => this.el("gameCelebration").replaceChildren(),
      1200,
    );
  }
  private addHistory(text: string) {
    const item = document.createElement("li");
    item.textContent = `${this.round}問目：${text}`;
    this.el("gameHistory").append(item);
  }
  private finish() {
    const newBest = this.score.points > this.best;
    if (newBest) {
      this.best = this.score.points;
      try {
        localStorage.setItem(this.bestKey, String(this.best));
      } catch {
        /* Best remains visible for this session. */
      }
    }
    const result = this.el("gameResult");
    const rank = document.createElement("strong");
    rank.className = "game-rank";
    rank.textContent = pitchGameRank(this.correct, this.rounds);
    const title = document.createElement("h3");
    title.textContent = newBest
      ? "自己ベスト更新！"
      : this.correct === this.rounds
        ? "全問成功！"
        : "ナイスチャレンジ！";
    const detail = document.createElement("p");
    detail.textContent = `${this.score.points} pt ・ 最大${this.score.bestStreak}連続成功。${this.correct < this.rounds ? "次はもう1問成功をめざそう。" : "難易度や音域を変えて挑戦してみよう。"}`;
    result.replaceChildren(rank, title, detail);
    result.hidden = false;
    this.stop(
      `終了！ ${this.rounds}問中${this.correct}問成功しました。下の結果で振り返れます。`,
    );
    this.el<HTMLButtonElement>("gameStart").textContent = "もう一度挑戦";
    this.updateScore();
    result.scrollIntoView({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  private draw() {
    const canvas = this.el<HTMLCanvasElement>("gameCanvas");
    const width = canvas.getBoundingClientRect().width;
    if (!width) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(260 * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fbfcfc";
    ctx.fillRect(0, 0, width, 260);
    const startMidi = this.settings?.startMidi ?? this.getSettings().startMidi;
    const y = (midi: number) => 240 - ((midi - startMidi) / 12) * 220;
    ctx.font = "12px system-ui";
    for (let i = 0; i <= 12; i++) {
      const at = y(startMidi + i);
      ctx.strokeStyle = "#e1e8eb";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, at);
      ctx.lineTo(width, at);
      ctx.stroke();
      ctx.fillStyle = "#5c6870";
      ctx.fillText(midiToNoteName(startMidi + i), 3, at + 4);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(40, 0, width - 40, 260);
    ctx.clip();
    if (this.target) {
      const at = y(hzToMidi(this.target.frequency));
      ctx.strokeStyle = "#146c75";
      ctx.lineWidth = this.challenge?.phase === "hold" ? 8 : 6;
      if (this.challenge?.phase === "hold") {
        ctx.shadowColor = "#15806d";
        ctx.shadowBlur = 18;
      }
      ctx.beginPath();
      ctx.moveTo(42, at);
      ctx.lineTo(width - 6, at);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = "#2b6cb0";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const latest = this.trace.at(-1)?.time ?? 0;
    let previous: { time: number; hz: number | null } | null = null;
    for (const point of this.trace) {
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
