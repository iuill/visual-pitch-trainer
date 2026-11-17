export function formatMicrophoneError(error: unknown): string {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "UnknownError";
  const prefix = `マイクを開始できませんでした（${name}）。`;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${prefix}ブラウザのマイク許可と、HTTPSで開いていることを確認してください。`;
    case "OverconstrainedError":
    case "NotFoundError":
      return `${prefix}共通設定のマイクを「既定のマイク」に戻すか、接続中の入力を選び直してください。`;
    case "NotReadableError":
    case "AbortError":
      return `${prefix}ほかのアプリでのマイク使用を止めて、もう一度開始してください。改善しない場合はページを開き直してください。`;
    default:
      return `${prefix}ブラウザのマイク許可と接続を確認してください。`;
  }
}
