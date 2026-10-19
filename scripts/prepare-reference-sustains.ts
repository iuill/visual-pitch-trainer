// Optional regeneration: Bun + ffmpeg. All downloads are pinned by SHA256.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PitchDetector } from "pitchy";
import sources from "./reference-sustain-sources.json";

const rate = 44100;
const detector = PitchDetector.forFloat32Array(8192);
const checksum = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const byInstrument = new Map<string, object[]>();
const cacheDir = ".tmp/reference-sources";
await mkdir(cacheDir, { recursive: true });

function measuredPitch(raw: Float32Array): number {
  const values: number[] = [];
  for (let i = 0; i + 8192 <= raw.length; i += 2048) {
    const [pitch, clarity] = detector.findPitch(
      raw.subarray(i, i + 8192),
      rate,
    );
    if (clarity > 0.9 && pitch > 50 && pitch < 3000) values.push(pitch);
  }
  values.sort((a, b) => a - b);
  if (values.length < 3) throw new Error("Cannot calibrate sustained sample.");
  return values[Math.floor(values.length / 2)];
}

for (const source of sources.samples) {
  const cachePath = `${cacheDir}/${source.sha256}`;
  let original = new Uint8Array(
    await Bun.file(cachePath)
      .arrayBuffer()
      .catch(() => new ArrayBuffer(0)),
  );
  if (checksum(original) !== source.sha256) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Sample download failed: ${source.url}`);
    original = new Uint8Array(await response.arrayBuffer());
    if (checksum(original) !== source.sha256)
      throw new Error(`Source checksum mismatch: ${source.url}`);
    await Bun.write(cachePath, original);
  }
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      "pipe:0",
      "-ss",
      String(source.startSeconds),
      "-t",
      String(source.durationSeconds + 0.3),
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { stdin: original, stdout: "pipe", stderr: "inherit" },
  );
  const raw = new Float32Array(
    await new Response(process.stdout).arrayBuffer(),
  );
  if ((await process.exited) !== 0) throw new Error("ffmpeg failed.");
  const frequency = measuredPitch(raw);
  // Whole periods keep the phase close while the wrap crossfade hides the join.
  const length = Math.round(
    (Math.floor(source.durationSeconds * frequency) * rate) / frequency,
  );
  const overlap = Math.round(
    (Math.max(2, Math.round(frequency * 0.04)) * rate) / frequency,
  );
  if (length > raw.length || length <= overlap + 8192)
    throw new Error("Sustain segment is too short.");
  const loop = raw.slice(overlap, length);
  for (let i = 0; i < overlap; i++) {
    const weight = i / (overlap - 1);
    loop[loop.length - overlap + i] =
      raw[length - overlap + i] * (1 - weight) + raw[i] * weight;
  }
  const dc = loop.reduce((sum, value) => sum + value, 0) / loop.length;
  let peak = 0;
  for (let i = 0; i < loop.length; i++) {
    loop[i] -= dc;
    peak = Math.max(peak, Math.abs(loop[i]));
  }
  if (peak < 0.001) throw new Error("Silent sustain segment.");
  // Calibrate the periodic loop, including its crossfade, rather than its label.
  const repeated = new Float32Array(rate * 3);
  for (let i = 0; i < repeated.length; i++) repeated[i] = loop[i % loop.length];
  const rootFrequency = measuredPitch(repeated);
  const expected = 440 * 2 ** ((source.midi - 69) / 12);
  if (Math.abs(1200 * Math.log2(rootFrequency / expected)) > 80)
    throw new Error(`Unexpected source pitch: ${source.file} ${rootFrequency}`);
  const wav = Buffer.alloc(44 + loop.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(loop.length * 2, 40);
  for (let i = 0; i < loop.length; i++)
    wav.writeInt16LE(Math.round((loop[i] / peak) * 0.7 * 32767), 44 + i * 2);
  const dir = `public/audio/${source.instrument}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(`${dir}/${source.file}`, wav);
  const samples = byInstrument.get(source.instrument) ?? [];
  samples.push({
    ...source,
    sourceSha256: source.sha256,
    sha256: checksum(wav),
    bytes: wav.length,
    rootFrequency,
    loopStart: 0,
    loopEnd: loop.length / rate,
  });
  byInstrument.set(source.instrument, samples);
  console.log(
    source.instrument +
      "/" +
      source.file +
      ": " +
      rootFrequency.toFixed(3) +
      " Hz",
  );
}

const license = await Bun.file("public/audio/piano/LICENSE.txt").text();
if (!license.includes("CC0 1.0 Universal"))
  throw new Error("CC0 license text missing.");
for (const [instrument, samples] of byInstrument) {
  await Bun.write(`public/audio/${instrument}/LICENSE.txt`, license);
  await Bun.write(
    `public/audio/${instrument}/sources.json`,
    `${JSON.stringify(
      {
        license: "CC0-1.0",
        processing:
          "Mono PCM16 44.1 kHz; sustain excerpt; whole-period crop and ~40 ms wrap crossfade; remove DC; peak-normalize to 0.7; calibrate repeated loop with pitchy. No recorded attack/release. Original pitch and vibrato may vary slightly within the loop.",
        samples,
      },
      null,
      2,
    )}\n`,
  );
}
