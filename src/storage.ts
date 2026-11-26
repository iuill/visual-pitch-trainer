export function readStoredText(
  key: string,
  onUnavailable?: () => void,
): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    onUnavailable?.();
    return null;
  }
}

export function readStoredJson(
  key: string,
  onUnavailable?: () => void,
): unknown {
  const text = readStoredText(key, onUnavailable);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeStoredValue(
  key: string,
  value: string | object | null,
  onUnavailable?: () => void,
) {
  try {
    localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  } catch {
    onUnavailable?.();
  }
}
