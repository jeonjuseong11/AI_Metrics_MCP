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
  SessionContentDigest,
  TokenTotals,
} from "../types.js";
import { isKnownExt, isKnownVerb, OTHER } from "../core/content.js";

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

// ── 내용 다이제스트 추출(role/usage 가드와 독립; 닫힌 어휘만 저장) ──────────────

const NAV_SKIP = new Set(["cd", "pushd", "popd", "set", "export", "sudo", "env"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 명령에서 첫 의미 토큰(내비 노이즈 스킵). 원시 토큰 반환 — 호출부가 닫힌 어휘로 분류. */
function firstMeaningfulVerb(command: string): string | null {
  for (const seg of command.split(/&&|;/)) {
    const tok = seg.trim().split(/\s+/)[0];
    if (!tok || NAV_SKIP.has(tok)) continue;
    return tok;
  }
  return null;
}

function emptyDigest(): SessionContentDigest {
  return { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {} };
}

function digestHasSignal(d: SessionContentDigest): boolean {
  return (
    d.userPrompts > 0 ||
    Object.keys(d.toolUses).length > 0 ||
    Object.keys(d.fileExts).length > 0 ||
    Object.keys(d.commandVerbs).length > 0
  );
}

/** message 1건의 내용을 digest에 누적(닫힌 어휘만 저장). role/usage 가드와 독립. */
function accumulateContent(d: SessionContentDigest, msg: Record<string, unknown>): void {
  const role = msg.role;
  const content = msg.content;

  if (role === "user") {
    if (typeof content === "string") {
      if (content.trim() !== "") d.userPrompts += 1;
    } else if (Array.isArray(content)) {
      if (content.some((it) => isObj(it) && it.type === "text")) d.userPrompts += 1;
    }
    return;
  }

  if (role === "assistant" && Array.isArray(content)) {
    for (const it of content) {
      if (!isObj(it) || it.type !== "tool_use") continue;
      const name = typeof it.name === "string" ? it.name : null;
      if (!name) continue;
      d.toolUses[name] = (d.toolUses[name] ?? 0) + 1;
      const input = it.input;
      if (!isObj(input)) continue;
      const fp = input.file_path ?? input.notebook_path;
      if (typeof fp === "string") {
        const m = /\.[A-Za-z0-9]{1,12}$/.exec(fp);
        if (m) {
          const ext = m[0].toLowerCase();
          const key = isKnownExt(ext) ? ext : OTHER;
          d.fileExts[key] = (d.fileExts[key] ?? 0) + 1;
        }
      }
      if ((name === "Bash" || name === "PowerShell") && typeof input.command === "string") {
        const verb = firstMeaningfulVerb(input.command);
        if (verb) {
          const key = isKnownVerb(verb) ? verb : OTHER;
          d.commandVerbs[key] = (d.commandVerbs[key] ?? 0) + 1;
        }
      }
    }
  }
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
  const digest = emptyDigest();

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

    // 내용 추출 — role/usage 가드 '위'에서(user 프롬프트·usage 없는 tool_use 포착).
    accumulateContent(digest, msg);

    if (msg.role !== "assistant") continue;
    if (msg.usage === undefined) continue; // assistant지만 usage 없음 = 정상 무시(메트릭만)

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

  const session: NormalizedSession = { sessionId, projectPath, messages, startTime, endTime };
  if (digestHasSignal(digest)) session.content = digest;

  return { session, warnings };
}
