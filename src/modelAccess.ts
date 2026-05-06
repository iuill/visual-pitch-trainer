type ModelAccessOptions = {
  label: string;
  modelUrl: string;
  minBytes?: number;
  setupHint: string;
};

export async function assertModelUrlAccessible({
  label,
  modelUrl,
  minBytes,
  setupHint,
}: ModelAccessOptions): Promise<void> {
  const response = await fetchModelHeaders(modelUrl);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const contentLength = Number(response.headers.get("content-length"));

  if (!response.ok) {
    throw new Error(
      `${label}モデルにアクセスできませんでした。${modelUrl} が ${response.status} を返しました。${setupHint}`,
    );
  }

  if (contentType.includes("text/html")) {
    throw new Error(
      `${label}モデルにアクセスしましたが、ONNXではなくHTMLが返りました。${modelUrl} のモデルファイルが未配置、または配信設定がフォールバックHTMLを返している可能性があります。${setupHint}`,
    );
  }

  if (
    minBytes !== undefined &&
    Number.isFinite(contentLength) &&
    contentLength > 0 &&
    contentLength < minBytes
  ) {
    throw new Error(
      `${label}モデルにアクセスしましたが、ファイルサイズが想定より小さいためONNXモデルではない可能性があります。${setupHint}`,
    );
  }
}

async function fetchModelHeaders(modelUrl: string): Promise<Response> {
  try {
    const response = await fetch(modelUrl, { method: "HEAD" });
    if (response.ok || response.status !== 405) {
      return response;
    }
  } catch {
    // Some model hosts do not support HEAD or CORS for HEAD. Fall back to a
    // tiny ranged GET and abort after headers are available.
  }

  const controller = new AbortController();
  try {
    return await fetch(modelUrl, {
      headers: {
        Range: "bytes=0-255",
      },
      signal: controller.signal,
    });
  } finally {
    controller.abort();
  }
}
