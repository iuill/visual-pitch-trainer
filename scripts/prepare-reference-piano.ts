// Optional asset regeneration: Bun + ffmpeg. Normal install/build needs neither download nor ffmpeg.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PitchDetector } from "pitchy";
import { PIANO_SAMPLES } from "../src/referenceInstruments";
import sources from "./reference-piano-sources.json";

const sampleRate = 44100;
const outputDirectory = "public/audio/piano";
const sourceBase = `https://raw.githubusercontent.com/sgossner/VCSL/${sources.commit}/`;
await mkdir(outputDirectory, { recursive: true });
const generated = [];

for (const [index, source] of sources.samples.entries()) {
  const sample = PIANO_SAMPLES[index];
  const url =
    sourceBase + source.path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed: ${response.status} ${source.path}`);
  const original = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(original).digest("hex");
  if (sha256 !== source.sha256)
    throw new Error(`Source checksum mismatch: ${source.path}`);
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-t",
      "6",
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

  const detector = PitchDetector.forFloat32Array(8192);
  const pitches: number[] = [];
  for (
    let offset = 8820;
    offset < Math.min(raw.length - 8192, 66150);
    offset += 4096
  ) {
    const [pitch, clarity] = detector.findPitch(
      raw.subarray(offset, offset + 8192),
      sampleRate,
    );
    if (clarity > 0.85) pitches.push(pitch);
  }
  pitches.sort((a, b) => a - b);
  const rootFrequency = pitches[Math.floor(pitches.length / 2)];
  if (
    !rootFrequency ||
    Math.abs(1200 * Math.log2(rootFrequency / sample.rootFrequency)) > 0.1
  ) {
    throw new Error(`Recorded pitch changed: ${source.path}`);
  }

  let peak = 0;
  for (const value of raw) peak = Math.max(peak, Math.abs(value));
  if (peak === 0) throw new Error(`Silent source: ${source.path}`);
  const onset = raw.findIndex((value) => Math.abs(value) > peak * 0.005);
  const start = Math.max(0, onset - 44);
  const frames = Math.min(raw.length - start, sampleRate * 4);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    const fade = Math.min(1, (frames - 1 - frame) / (sampleRate * 0.15));
    wav.writeInt16LE(
      Math.round((raw[start + frame] / peak) * 0.7 * fade * 32767),
      44 + frame * 2,
    );
  }
  await Bun.write(`${outputDirectory}/${sample.file}`, wav);
  generated.push({
    ...sample,
    source: source.path,
    sourceSha256: sha256,
    sha256: createHash("sha256").update(wav).digest("hex"),
    bytes: wav.length,
  });
  console.log(
    `${sample.file}: ${wav.length} bytes, recorded root ${rootFrequency.toFixed(3)} Hz`,
  );
}

const licenseResponse = await fetch(`${sourceBase}LICENSE`);
if (!licenseResponse.ok) throw new Error("CC0 license download failed.");
const license = await licenseResponse.text();
if (!license.includes("CC0 1.0 Universal"))
  throw new Error("Unexpected source license.");
await Bun.write(`${outputDirectory}/LICENSE.txt`, license);
await Bun.write(
  `${outputDirectory}/sources.json`,
  `${JSON.stringify(
    {
      library: "Versilian Community Sample Library (VCSL)",
      repository: "https://github.com/sgossner/VCSL",
      commit: sources.commit,
      license: "CC0-1.0",
      instrument: "Grand Piano, Kawai / Sustains / v2 / rr1 / Player",
      processing:
        "Mono 44.1 kHz PCM16; trim leading silence (1 ms pre-roll), cap at 4 s, peak-normalize to 0.7, fade final 150 ms. Original VCSL octave names are one lower than scientific pitch notation. Recorded pitch calibrated with pitchy.",
      samples: generated,
    },
    null,
    2,
  )}\n`,
);
