import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type PitchModel = {
  name: string;
  outputPath: string;
  sourceUrl: string;
  expectedBytes: number;
  expectedSha256: string;
  envName: string;
};

const models: PitchModel[] = [
  {
    name: "CREPE small",
    outputPath: "public/models/crepe-small.onnx",
    sourceUrl:
      "https://github.com/yqzhishen/onnxcrepe/releases/download/v1.1.0/small.onnx",
    expectedBytes: 6_524_192,
    expectedSha256:
      "cd119f6f5f608d9342a1c6f81e4653f21dbcde440a96d474ecbf6f27c6253466",
    envName: "CREPE_SMALL_MODEL_SOURCE_URL",
  },
  {
    name: "CREPE medium",
    outputPath: "public/models/crepe-medium.onnx",
    sourceUrl:
      "https://github.com/yqzhishen/onnxcrepe/releases/download/v1.1.0/medium.onnx",
    expectedBytes: 23_525_293,
    expectedSha256:
      "9bd7cd61bfd07596c7861e580ca04ef7170407994956d4c554ffd4863fb43ae3",
    envName: "CREPE_MEDIUM_MODEL_SOURCE_URL",
  },
  {
    name: "CREPE large",
    outputPath: "public/models/crepe-large.onnx",
    sourceUrl:
      "https://github.com/yqzhishen/onnxcrepe/releases/download/v1.1.0/large.onnx",
    expectedBytes: 51_012_147,
    expectedSha256:
      "3f1a5245982dad1a4a357278861ad1ea0d0aed6f04888dcec92df9b8c873a790",
    envName: "CREPE_LARGE_MODEL_SOURCE_URL",
  },
  {
    name: "CREPE full",
    outputPath: "public/models/crepe-full.onnx",
    sourceUrl:
      "https://github.com/yqzhishen/onnxcrepe/releases/download/v1.1.0/full.onnx",
    expectedBytes: 88_984_790,
    expectedSha256:
      "119845c72c702e052e5262430f9d120bce46176689aa226c39d09dea5cc3a610",
    envName: "CREPE_FULL_MODEL_SOURCE_URL",
  },
  {
    name: "RMVPE",
    outputPath: "public/models/rmvpe.onnx",
    sourceUrl:
      "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.onnx",
    expectedBytes: 361_688_443,
    expectedSha256:
      "5370e71ac80af8b4b7c793d27efd51fd8bf962de3a7ede0766dac0befa3660fd",
    envName: "RMVPE_MODEL_SOURCE_URL",
  },
];

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    const stream = Bun.file(path).stream();

    for await (const chunk of stream) {
      hash.update(chunk);
    }

    return hash.digest("hex");
  } catch {
    return null;
  }
}

async function downloadModel(model: PitchModel): Promise<void> {
  const outputPath = resolve(model.outputPath);
  const existingSize = await fileSize(outputPath);

  if (
    existingSize === model.expectedBytes &&
    (await fileSha256(outputPath)) === model.expectedSha256
  ) {
    console.log(
      `${model.name}: already downloaded (${formatBytes(existingSize)})`,
    );
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });

  const sourceUrl = process.env[model.envName] || model.sourceUrl;
  const tempPath = `${outputPath}.download`;

  console.log(`${model.name}: downloading ${sourceUrl}`);
  await rm(tempPath, { force: true });

  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `${model.name}: failed to download (${response.status} ${response.statusText})`,
    );
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(tempPath, { flags: "wx" }),
  );

  await validateModelFile(tempPath, model);

  await rename(tempPath, outputPath);
  console.log(`${model.name}: saved ${formatBytes(model.expectedBytes)}`);
}

async function validateModelFile(path: string, model: PitchModel) {
  const downloadedSize = await fileSize(path);
  const downloadedSha256 = await fileSha256(path);

  if (
    downloadedSize !== model.expectedBytes ||
    downloadedSha256 !== model.expectedSha256
  ) {
    await rm(path, { force: true });
    throw new Error(
      `${model.name}: expected ${formatBytes(model.expectedBytes)} and sha256 ${
        model.expectedSha256
      }, got ${
        downloadedSize === null ? "missing file" : formatBytes(downloadedSize)
      } and sha256 ${downloadedSha256 ?? "unavailable"}`,
    );
  }
}

function formatBytes(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(1)} MiB`;
}

for (const model of models) {
  await downloadModel(model);
}
