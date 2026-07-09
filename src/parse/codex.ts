/**
 * Codex CLI 세션 로그(JSONL) 파서 — 어댑터.
 *
 * 포맷(실측 2026-06/07): rollout-*.jsonl, 각 라인 { timestamp, type, payload }.
 *   - session_meta: { id, cwd }              → sessionId, projectPath
 *   - turn_context: { model, cwd }           → 현재 모델(예 gpt-5.3-codex)
 *   - event_msg/token_count: info.last_token_usage
 *        { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
 *   - event_msg/user_message                 → userPrompts
 *   - response_item/function_call: shell_command|apply_patch|update_plan
 *
 * 토큰 매핑: last_token_usage(턴 델타)를 이벤트마다 메시지로 push → 합=총합, 시각 span 보존.
 * ponytail: last_token_usage 합 가정(중복 token_count 없다고 봄). 틀리면 최종 total_token_usage로 교체.
 *
 * 견고성(SourceAdapter 계약): 라인 손상은 skip+warning, 절대 throw 안 함.
 */

import type { NormalizedMessage, NormalizedSession, ParseWarning, SessionContentDigest, TokenTotals } from "../types.js";
import { isKnownExt, isKnownVerb, OTHER } from "../core/content.js";

// ponytail: parse/claudeCode의 digest 헬퍼가 export 안 돼 있어 ~8줄 복제(2파일 리팩터보다 쌈).
const NAV_SKIP = new Set(["cd", "pushd", "popd", "set", "export", "sudo", "env"]);
function firstVerb(cmd: string): string | null {
  for (const seg of cmd.split(/&&|;/)) {
    const t = seg.trim().split(/\s+/)[0];
    if (!t || NAV_SKIP.has(t)) continue;
    return t;
  }
  return null;
}
function extOf(path: string): string | null {
  const m = /\.[A-Za-z0-9]{1,12}(?=$|["'\s])/.exec(path.trim());
  return m ? m[0].toLowerCase() : null;
}

/** codex 도구명 → 공유 어휘(content.ts TOOL_ACTIVITY)로 정규화 → 도구 간 롤업 일치. */
const CODEX_TOOL: Record<string, string> = { shell_command: "Bash", apply_patch: "Edit", update_plan: "TodoWrite" };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** last_token_usage → TokenTotals. 캐시 입력은 cacheRead로(정가 10%), reasoning은 output에 합산. */
function mapTokens(tu: unknown): TokenTotals | null {
  if (!isObj(tu)) return null;
  const input = num(tu.input_tokens);
  const output = num(tu.output_tokens);
  if (input === null || output === null) return null;
  const cached = num(tu.cached_input_tokens) ?? 0;
  const reasoning = num(tu.reasoning_output_tokens) ?? 0;
  const cacheRead = Math.min(cached, input);
  return { input: input - cacheRead, output: output + reasoning, cacheRead, cacheCreation: 0 };
}

function emptyDigest(): SessionContentDigest {
  return { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {} };
}
function digestHasSignal(d: SessionContentDigest): boolean {
  return d.userPrompts > 0 || Object.keys(d.toolUses).length > 0 || Object.keys(d.fileExts).length > 0 || Object.keys(d.commandVerbs).length > 0;
}

/** function_call 1건을 digest에 누적(도구·명령동사·파일확장자). */
function accumulateCall(d: SessionContentDigest, name: string, argsRaw: unknown): void {
  const tool = CODEX_TOOL[name] ?? name;
  d.toolUses[tool] = (d.toolUses[tool] ?? 0) + 1;

  let args: unknown = argsRaw;
  if (typeof argsRaw === "string") {
    try {
      args = JSON.parse(argsRaw);
    } catch {
      args = argsRaw; // 문자열 그대로 두고 아래에서 패치 파일경로만 훑음
    }
  }

  if (name === "shell_command" && isObj(args) && typeof args.command === "string") {
    const verb = firstVerb(args.command);
    if (verb) {
      const key = isKnownVerb(verb) ? verb : OTHER;
      d.commandVerbs[key] = (d.commandVerbs[key] ?? 0) + 1;
    }
  }
  if (name === "apply_patch") {
    // 패치 텍스트에서 "*** ... File: <path>"의 확장자만 추출(원시 경로 미저장).
    const patch = typeof args === "string" ? args : isObj(args) && typeof args.input === "string" ? args.input : "";
    for (const m of patch.matchAll(/File:\s*(\S+)/g)) {
      const ext = extOf(m[1] ?? "");
      if (ext) {
        const key = isKnownExt(ext) ? ext : OTHER;
        d.fileExts[key] = (d.fileExts[key] ?? 0) + 1;
      }
    }
  }
}

/** rollout JSONL 문자열 1개(=세션 1개)를 정규화. 순수 함수. */
export function parseCodexSession(
  content: string,
  fallbackId: string,
): { session: NormalizedSession; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const messages: NormalizedMessage[] = [];
  const digest = emptyDigest();
  let sessionId = fallbackId;
  let projectPath: string | undefined;
  let model = "unknown";

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.trim() === "") continue;

    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      warnings.push({ line: i + 1, reason: "JSON 파싱 실패 — 라인 skip" });
      continue;
    }
    if (!isObj(obj)) continue;
    const type = obj.type;
    const p = isObj(obj.payload) ? obj.payload : {};
    const ts = typeof obj.timestamp === "string" ? new Date(obj.timestamp) : new Date(NaN);

    if (type === "session_meta") {
      if (typeof p.id === "string") sessionId = p.id;
      if (typeof p.cwd === "string") projectPath = p.cwd;
      continue;
    }
    if (type === "turn_context") {
      if (typeof p.model === "string") model = p.model;
      if (!projectPath && typeof p.cwd === "string") projectPath = p.cwd;
      continue;
    }
    if (type === "event_msg") {
      if (p.type === "user_message") {
        digest.userPrompts += 1;
      } else if (p.type === "token_count" && isObj(p.info)) {
        const tokens = mapTokens((p.info as Record<string, unknown>).last_token_usage);
        if (tokens && !Number.isNaN(ts.getTime())) messages.push({ model, timestamp: ts, tokens });
      }
      continue;
    }
    if (type === "response_item" && p.type === "function_call" && typeof p.name === "string") {
      accumulateCall(digest, p.name, p.arguments);
    }
  }

  const times = messages.map((m) => m.timestamp.getTime());
  const startTime = times.length ? new Date(Math.min(...times)) : undefined;
  const endTime = times.length ? new Date(Math.max(...times)) : undefined;

  const session: NormalizedSession = { sessionId, projectPath, messages, startTime, endTime };
  if (digestHasSignal(digest)) session.content = digest;
  return { session, warnings };
}
