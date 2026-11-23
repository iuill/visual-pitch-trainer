export type GeneratedInstrument =
  | "electric-guitar"
  | "electric-bass"
  | "synth-lead"
  | "mellotron";

export function isGeneratedInstrument(
  instrument: string,
): instrument is GeneratedInstrument {
  return (
    instrument === "electric-guitar" ||
    instrument === "electric-bass" ||
    instrument === "synth-lead" ||
    instrument === "mellotron"
  );
}

export function createInstrumentBuffer(
  context: BaseAudioContext,
  instrument: GeneratedInstrument,
  frequency: number,
) {
  const sampleRate = 24_000;
  const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
  const samples = buffer.getChannelData(0);
  if (instrument === "synth-lead" || instrument === "mellotron") {
    renderKeys(samples, sampleRate, frequency, instrument === "mellotron");
    return buffer;
  }
  const guitar = instrument === "electric-guitar";
  const harmonics = guitar ? 12 : 7;
  // Higher string harmonics decay faster after the pick attack.
  for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
    if (frequency * harmonic >= sampleRate / 2) break;
    const angle = (2 * Math.PI * frequency * harmonic) / sampleRate;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const decay = Math.exp(
      -(1.1 + harmonic * (guitar ? 1.3 : 2.1)) / sampleRate,
    );
    let real =
      harmonic === 1
        ? 0.88
        : ((guitar ? 0.77 : 0.43) * Math.sin(harmonic * 0.59)) /
          Math.sqrt(harmonic);
    let imaginary = 0;
    for (let index = 0; index < samples.length; index++) {
      samples[index] += imaginary;
      const nextImaginary = (imaginary * cos + real * sin) * decay;
      real = (real * cos - imaginary * sin) * decay;
      imaginary = nextImaginary;
    }
  }
  // Saturate the guitar and roll off the brightest harmonics like a speaker.
  let filtered = 0;
  for (let index = 0; index < samples.length; index++) {
    const signal = Math.tanh(samples[index] * (guitar ? 3.6 : 1.45));
    filtered += (signal - filtered) * (guitar ? 0.46 : 0.32);
    samples[index] = filtered * (guitar ? 0.62 : 0.71);
  }
  return buffer;
}

function renderKeys(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
  mellotron: boolean,
) {
  const cyclesPerSample = (2 * Math.PI * frequency) / sampleRate;
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const phase = cyclesPerSample * index;
    if (mellotron) {
      // Detuned layers and gentle wow and flutter suggest a tape keyboard.
      const wow = 0.75 * Math.sin(2 * Math.PI * 0.8 * time);
      const flutter = 0.1 * Math.sin(2 * Math.PI * 6.3 * time);
      const tape = phase * 0.997 + wow + flutter;
      samples[index] =
        0.21 * Math.sin(phase * 1.003) +
        0.27 * Math.sin(tape) +
        0.12 * Math.sin(tape * 2) +
        0.048 * Math.sin(tape * 3) +
        0.022 * Math.sin(tape * 5);
    } else {
      const vibrato =
        0.46 * Math.min(1, time * 3) * Math.sin(2 * Math.PI * 5.2 * time);
      const lead = phase + vibrato;
      samples[index] =
        0.37 * Math.sin(lead) +
        0.13 * Math.sin(3 * lead) +
        0.07 * Math.sin(5 * lead) +
        0.08 * Math.sin(phase * 1.005);
    }
  }
}
