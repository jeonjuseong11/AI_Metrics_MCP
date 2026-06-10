/**
 * "어제 한 일" 요약 — 전송 경계가 여기 있다.
 *
 *   커밋 ─▶ 컨텍스트 빌드 ─▶ 마스킹(fail-closed) ─▶ [승인] ─▶ LLM ─▶ 산문
 *
 * 규칙:
 *  - 마스킹은 fail-closed: maskSecrets가 throw하면 전송하지 않는다(호출부 폴백).
 *  - 요약 실패(키 없음·타임아웃·빈·거부)는 SummarizerError로 던진다 → 폴백.
 *  - 메트릭은 절대 이 경로를 타지 않는다(결정적 계산, LLM 우회).
 */

import { maskSecrets, type Redaction } from "./mask.js";
import { SummarizerError, type Summarizer } from "../llm/summarizer.js";
import type { Commit } from "../parse/git.js";

/** LLM에 보낼 데이터 블록(지시문은 클라이언트가 감싼다). 마스킹 전 원본. */
export function buildSummaryContext(commits: Commit[]): string {
  return commits.map((c) => `- ${c.shortHash} ${c.subject}`).join("\n");
}

export interface PreparedSend {
  /** 마스킹을 거쳐 실제로 전송될 컨텍스트. */
  maskedContext: string;
  redactions: Redaction[];
}

/**
 * 전송 준비: 컨텍스트 빌드 + 마스킹(fail-closed).
 * maskSecrets가 throw하면 그대로 전파된다(전송 차단).
 */
export function prepareSend(commits: Commit[]): PreparedSend {
  const raw = buildSummaryContext(commits);
  const { masked, redactions } = maskSecrets(raw);
  return { maskedContext: masked, redactions };
}

export interface SummaryResult {
  prose: string;
  redactions: Redaction[];
}

/**
 * 마스킹된 컨텍스트를 요약기에 보내 "어제 한 일" 산문을 얻는다.
 * 실패 시 SummarizerError/MaskerError를 던진다 → 호출부가 커밋 목록으로 폴백.
 */
export async function summarizeAccomplishments(commits: Commit[], summarizer: Summarizer): Promise<SummaryResult> {
  if (commits.length === 0) {
    throw new SummarizerError("empty", "요약할 커밋이 없습니다.");
  }
  const { maskedContext, redactions } = prepareSend(commits);
  const prose = await summarizer(maskedContext);
  if (typeof prose !== "string" || prose.trim() === "") {
    throw new SummarizerError("empty", "요약기가 빈 응답을 반환했습니다.");
  }
  return { prose: prose.trim(), redactions };
}
