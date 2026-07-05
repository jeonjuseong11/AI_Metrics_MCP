/**
 * 내용 기반 성과 추출 — "무엇을 만들었나(내용 기반)"의 원시-텍스트 경로.
 *
 * ⚠️ 프라이버시: 이 모듈만 세션의 **원시 텍스트**(user 프롬프트 + tool_use 파일 경로)를 다룬다.
 * 결정적 파이프라인(digest/거울/초상)은 절대 이 원시 텍스트를 보지 않는다 — 원시 텍스트는 여기서
 * 추출→마스킹(fail-closed)→LLM 전송 후 버려진다. **--send 경로에서만** 사용(opt-in, 외부 전송).
 *
 * 결정(사용자): 보내는 것 = 프롬프트 + 파일 경로만(어시스턴트 답변 전문 제외 — 노출·비용 최소).
 */

import { readFile } from "node:fs/promises";
import { toKstDateString } from "./day.js";
import { maskSecrets, type Redaction } from "./mask.js";

export interface Intent {
  /** user 요청문(원시). */
  prompts: string[];
  /** tool_use가 다룬 파일 경로(원시, 중복 제거). */
  files: string[];
}

// 전송 상한 — 노출면·비용 억제(닫힌 게 아니라 원시라 특히 보수적).
const MAX_PROMPTS = 60;
const MAX_FILES = 80;
const MAX_PROMPT_CHARS = 300;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 경로에서 basename만(머신 구조·홈·타 프로젝트 경로 노출 제거). posix·win 구분자 모두. */
function baseName(fp: string): string {
  const parts = fp.split(/[\\/]/);
  return parts[parts.length - 1] || fp;
}

/**
 * 시스템·스킬이 주입한 "user" 메시지(진짜 내 요청 아님)를 걸러낸다 — 외부 전송 노이즈·노출 최소.
 * 스킬 호출 덤프·태스크 알림·시스템 리마인더·거대 diff·리뷰 보일러플레이트.
 */
const NOISE_PATTERNS: RegExp[] = [
  /<command-(message|name|args)>/,
  /<task-notification>/,
  /<system-reminder>/,
  /^Base directory for this skill/,
  /AUTO-GENERATED from/,
  /Review this change for security vulnerabilities/,
  /Unified diff|=== DIFF:/,
];

function isNoisePrompt(s: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(s));
}

/**
 * 세션 JSONL 1개에서 user 프롬프트 텍스트 + tool_use 파일 경로 + 세션 시작시각(창 필터용)을 뽑는다. 순수.
 * 시작시각은 analyze의 세션 귀속과 일관되도록 usage 있는 assistant 레코드 timestamp의 최소값.
 */
export function extractIntent(content: string): { prompts: string[]; files: string[]; startTime?: Date } {
  const prompts: string[] = [];
  const files = new Set<string>();
  const times: number[] = [];

  for (const raw of content.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isObj(obj)) continue;
    const message = obj.message;
    if (!isObj(message)) continue;

    if (message.role === "user") {
      const c = message.content;
      if (typeof c === "string") {
        const t = c.trim();
        if (t && !isNoisePrompt(t)) prompts.push(t);
      } else if (Array.isArray(c)) {
        for (const it of c) {
          if (isObj(it) && it.type === "text" && typeof it.text === "string") {
            const t = it.text.trim();
            if (t && !isNoisePrompt(t)) prompts.push(t);
          }
        }
      }
    }

    if (message.role === "assistant") {
      if (message.usage !== undefined && typeof obj.timestamp === "string") {
        const d = new Date(obj.timestamp);
        if (!Number.isNaN(d.getTime())) times.push(d.getTime());
      }
      if (Array.isArray(message.content)) {
        for (const it of message.content) {
          if (!isObj(it) || it.type !== "tool_use" || !isObj(it.input)) continue;
          const fp = it.input.file_path ?? it.input.notebook_path;
          if (typeof fp === "string" && fp.trim()) files.add(baseName(fp)); // basename만(경로 노출 제거)
        }
      }
    }
  }

  const startTime = times.length ? new Date(Math.min(...times)) : undefined;
  return startTime ? { prompts, files: [...files], startTime } : { prompts, files: [...files] };
}

/**
 * 세션 파일들을 읽어 KST 창 안 세션의 프롬프트+파일을 모은다(창 판정은 세션 startTime의 KST 날짜).
 * 읽기 실패·startTime 없는 세션은 스킵(창 판정 불가). 원시 텍스트를 메모리에 든다 — 호출부가 즉시 마스킹.
 */
export async function collectIntents(sessionFiles: string[], window: { start?: string; end?: string } = {}): Promise<Intent> {
  const prompts: string[] = [];
  const files = new Set<string>();

  for (const f of sessionFiles) {
    let content: string;
    try {
      content = await readFile(f, "utf-8");
    } catch {
      continue;
    }
    const ex = extractIntent(content);
    if (!ex.startTime) continue;
    const kd = toKstDateString(ex.startTime);
    if (window.start && kd < window.start) continue;
    if (window.end && kd > window.end) continue;
    prompts.push(...ex.prompts);
    for (const p of ex.files) files.add(p);
  }
  return { prompts, files: [...files] };
}

/** 마스킹 전 원시 사실 블록(요청 + 다룬 파일). 상한 적용. */
export function buildIntentContext(intent: Intent): string {
  const lines: string[] = [];
  const ps = intent.prompts.slice(0, MAX_PROMPTS).map((p) => {
    const one = p.replace(/\s+/g, " ").trim();
    return one.length > MAX_PROMPT_CHARS ? one.slice(0, MAX_PROMPT_CHARS) + "…" : one;
  });
  if (ps.length > 0) {
    lines.push("[요청]");
    for (const p of ps) lines.push(`- ${p}`);
  }
  const fs = intent.files.slice(0, MAX_FILES);
  if (fs.length > 0) {
    lines.push("[다룬 파일]");
    lines.push(fs.join(" · "));
  }
  return lines.join("\n");
}

export interface PreparedIntent {
  masked: string;
  redactions: Redaction[];
}

/** 전송 준비: 원시 블록 빌드 + 마스킹(fail-closed, maskSecrets throw 시 전파 → 전송 차단). */
export function prepareIntentSend(intent: Intent): PreparedIntent {
  const { masked, redactions } = maskSecrets(buildIntentContext(intent));
  return { masked, redactions };
}
