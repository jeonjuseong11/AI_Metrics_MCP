/**
 * SessionStart 거울 — stdin source 필터 + top-level systemMessage 출력.
 *
 * 스파이크 실측(CC v2.1.195): 사용자 표출은 **top-level `systemMessage`**.
 * `hookSpecificOutput.systemMessage`(nested)·`additionalContext`는 사용자 비표출.
 * 거울은 startup·resume에만(compact·clear 스킵 — 스팸 방지).
 */

/** stdin JSON에서 source 추출. 부재/파싱실패 시 "unknown". */
export function parseSessionSource(raw: string): string {
  try {
    const v = JSON.parse(raw) as { source?: unknown };
    return typeof v.source === "string" ? v.source : "unknown";
  } catch {
    return "unknown";
  }
}

/** 거울을 낼 source인가 — startup·resume만(나머지 스킵). */
export function shouldMirror(source: string): boolean {
  return source === "startup" || source === "resume";
}

/** hook 출력 JSON — systemMessage는 top-level(스파이크 정정). */
export function toHookOutput(systemMessage: string): string {
  return JSON.stringify({ systemMessage });
}
