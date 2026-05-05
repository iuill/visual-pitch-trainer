export type DecodedMediaAudio = {
  sampleRate: number;
  channels: Float32Array[];
  durationSec: number;
  source: "web-audio" | "mediabunny";
};

export async function decodeMediaAudio(
  file: File,
  audioContext: AudioContext,
): Promise<DecodedMediaAudio> {
  if (shouldDecodeWithMediabunnyFirst(file)) {
    try {
      return await decodeWithMediabunny(file);
    } catch (mediabunnyError) {
      throw new AggregateError(
        [mediabunnyError],
        "Could not decode media audio.",
      );
    }
  }

  try {
    return await decodeWithWebAudio(file, audioContext);
  } catch (webAudioError) {
    try {
      return await decodeWithMediabunny(file);
    } catch (mediabunnyError) {
      throw new AggregateError(
        [webAudioError, mediabunnyError],
        "Could not decode media audio.",
      );
    }
  }
}

function shouldDecodeWithMediabunnyFirst(file: File): boolean {
  if (file.type.startsWith("video/")) {
    return true;
  }

  return /\.(mkv|mov|mp4|webm)$/i.test(file.name);
}

export function mixChannelsToMono(channels: Float32Array[]): Float32Array {
  const length = Math.max(...channels.map((channel) => channel.length), 0);
  const mixed = new Float32Array(length);

  if (channels.length === 0) {
    return mixed;
  }

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      mixed[index] += channel[index] / channels.length;
    }
  }

  return mixed;
}

export function createWavBlobFromDecodedAudio(
  decodedAudio: DecodedMediaAudio,
): Blob {
  const channelCount = Math.max(1, decodedAudio.channels.length);
  const sampleRate = decodedAudio.sampleRate;
  const frameCount = Math.max(
    ...decodedAudio.channels.map((channel) => channel.length),
    0,
  );
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  offset = writeAscii(view, offset, "RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  offset = writeAscii(view, offset, "WAVE");
  offset = writeAscii(view, offset, "fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  offset = writeAscii(view, offset, "data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = decodedAudio.channels[channelIndex]?.[frame] ?? 0;
      view.setInt16(offset, floatToPcm16(sample), true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeWithWebAudio(
  file: File,
  audioContext: AudioContext,
): Promise<DecodedMediaAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  return {
    sampleRate: audioBuffer.sampleRate,
    channels: copyAudioBufferChannels(audioBuffer),
    durationSec: audioBuffer.duration,
    source: "web-audio",
  };
}

async function decodeWithMediabunny(file: File): Promise<DecodedMediaAudio> {
  const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import(
    "mediabunny"
  );
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  try {
    const audioTrack = await input.getPrimaryAudioTrack();

    if (!audioTrack) {
      throw new Error("No audio track found.");
    }

    if (!(await audioTrack.canDecode())) {
      throw new Error("The primary audio track cannot be decoded.");
    }

    const sink = new AudioBufferSink(audioTrack);
    const buffers: AudioBuffer[] = [];
    let totalLength = 0;
    let sampleRate = audioTrack.sampleRate;
    let channelCount = audioTrack.numberOfChannels;

    for await (const wrappedBuffer of sink.buffers()) {
      buffers.push(wrappedBuffer.buffer);
      totalLength += wrappedBuffer.buffer.length;
      sampleRate = wrappedBuffer.buffer.sampleRate || sampleRate;
      channelCount = Math.max(
        channelCount,
        wrappedBuffer.buffer.numberOfChannels,
      );
    }

    if (buffers.length === 0 || totalLength === 0) {
      throw new Error("No decoded audio buffers were produced.");
    }

    const channels = concatenateAudioBuffers(buffers, channelCount);

    return {
      sampleRate,
      channels,
      durationSec: totalLength / sampleRate,
      source: "mediabunny",
    };
  } finally {
    input.dispose();
  }
}

function copyAudioBufferChannels(audioBuffer: AudioBuffer): Float32Array[] {
  return Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => new Float32Array(audioBuffer.getChannelData(channel)),
  );
}

function concatenateAudioBuffers(
  buffers: AudioBuffer[],
  channelCount: number,
): Float32Array[] {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const channels = Array.from(
    { length: Math.max(1, channelCount) },
    () => new Float32Array(totalLength),
  );
  let offset = 0;

  for (const buffer of buffers) {
    for (
      let channelIndex = 0;
      channelIndex < channels.length;
      channelIndex += 1
    ) {
      const sourceChannel = Math.min(channelIndex, buffer.numberOfChannels - 1);
      channels[channelIndex]?.set(buffer.getChannelData(sourceChannel), offset);
    }

    offset += buffer.length;
  }

  return channels;
}

function writeAscii(view: DataView, offset: number, value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }

  return offset + value.length;
}

function floatToPcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));

  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}
