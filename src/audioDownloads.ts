import type { VocalSeparationModelId } from "./vocalSeparation";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function vocalDownloadName(
  file: File,
  modelId: VocalSeparationModelId,
): string {
  return `${audioFileBaseName(file)}-${modelId}-vocals.mp3`;
}

export function audioFileBaseName(file: File): string {
  const fileName = file.name;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const safeName = withoutExtension
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeName || "audio";
}
