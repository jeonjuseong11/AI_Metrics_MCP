/**
 * Claude Code 세션 로그(JSONL) 파서 — 어댑터.
 *
 * 부록 A "A1/비공식 데이터 소스" 결정: Claude Code 내부 포맷에 결합되는 유일한
 * 지점이므로 어댑터로 격리한다. 포맷이 바뀌면 이 파일만 고친다.
 *
 * 견고성 규칙(§4.4, 부록 A 테스트):
 *  - 레코드 단위 손상(JSON 파싱 실패) → 해당 라인 skip + warning. 절대 abort 안 함.
 *  - assistant가 아니거나 usage 없는 라인 → 조용히 무시(정상, 경고 아님).
 *  - usage 필드가 비정상(숫자 아님) → 0으로 강제하지 않고 라인 skip + warning.
 *
 * 실측 구조(2026-06-10): 각 라인은 JSON 객체.
 *   { "timestamp": "2026-06-02T12:58:24.798Z",
 *     "sessionId": "...",
 *     "message": { "role": "assistant", "model": "claude-opus-4-8",
 *                  "usage": { "input_tokens": ..., "output_tokens": ...,
 *                             "cache_read_input_tokens": ...,
 *                             "cache_creation_input_tokens": ... } } }
 */

import type {
  NormalizedMessage,
  NormalizedSession,
  ParseWarning,
  RawUsage,
  TokenTotals,
} from "../types.js";

/** 숫자로 강제하되 비정상이면 null(호출부가 라인 skip 판단). */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** usage 객체에서 TokenTotals 추출. 핵심 4필드 중 하나라도 비정상이면 null. */
function extractTokens(usage: unknown): TokenTotals | null {
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Partial<Record<keyof RawUsage, unknown>>;
  const input = toFiniteNumber(u.input_tokens);
  const output = toFiniteNumber(u.output_tokens);
  // 캐시 필드는 옛 버전 로그엔 없을 수 있으므로 부재는 0 허용, 비정상(문자열 등)만 거부.
  const cacheRead = u.cache_read_input_tokens === undefined ? 0 : toFiniteNumber(u.cache_read_input_tokens);
  const cacheCreation = u.cache_creation_input_tokens === undefined ? 0 : toFiniteNumber(u.cache_creation_input_tokens);
  if (input === null || output === null || cacheRead === null || cacheCreation === null) return null;
  return { input, output, cacheRead, cacheCreation };
}

function parseTimestamp(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * JSONL 문자열 1개(= 세션 1개)를 정규화. 순수 함수 — 테스트 용이.
 */
export function parseSessionContent(
  content: string,
  sessionId: string,
  projectPath?: string,
): { session: NormalizedSession; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const messages: NormalizedMessage[] = [];

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.trim() === "") continue;
    const lineNo = i + 1;

    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      warnings.push({ line: lineNo, reason: "JSON 파싱 실패 — 라인 skip" });
      continue;
    }
    if (typeof obj !== "object" || obj === null) continue;

    const rec = obj as Record<string, unknown>;
    const message = rec.message;
    if (typeof message !== "object" || message === null) continue;
    const msg = message as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    if (msg.usage === undefined) continue; // assistant지만 usage 없음 = 정상 무시

    const tokens = extractTokens(msg.usage);
    if (tokens === null) {
      warnings.push({ line: lineNo, reason: "usage 필드 비정상 — 라인 skip" });
      continue;
    }

    const ts = parseTimestamp(rec.timestamp);
    if (ts === null) {
      warnings.push({ line: lineNo, reason: "timestamp 누락/비정상 — 라인 skip" });
      continue;
    }

    const model = typeof msg.model === "string" ? msg.model : "unknown";
    messages.push({ model, timestamp: ts, tokens });
  }

  const times = messages.map((m) => m.timestamp.getTime());
  const startTime = times.length ? new Date(Math.min(...times)) : undefined;
  const endTime = times.length ? new Date(Math.max(...times)) : undefined;

  return {
    session: { sessionId, projectPath, messages, startTime, endTime },
    warnings,
  };
}
