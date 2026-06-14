/**
 * 실제 Anthropic 호출기 — Summarizer 인터페이스 구현(요약기/내레이터 2종).
 *
 * 둘 다 저가 모델 기본(claude-haiku-4-5). 키는 ANTHROPIC_API_KEY, 없으면
 * SummarizerError('no-api-key'). 시스템 프롬프트로 "수치 임의 생성 금지"를 제약한다.
 * 호출 로직은 makeAnthropicCaller 하나로 DRY.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SummarizerError, type Summarizer } from "./summarizer.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

const SUMMARY_SYSTEM_PROMPT = [
  "당신은 개발자의 어제 Git 커밋 목록을 받아 일일 스크럼의 '어제 한 일' 항목으로 간결히 요약한다.",
  "규칙:",
  "- 커밋에 없는 성과·수치·지표를 절대 지어내지 말 것.",
  "- 한국어, 불릿(- )으로. 관련 커밋을 묶어 자연스럽게.",
  "- 각 항목 끝에 근거 커밋 해시를 (해시) 형태로 표기.",
  "- 출력은 불릿 목록만. 머리말·맺음말 없이.",
].join("\n");

const NARRATIVE_SYSTEM_PROMPT = [
  "당신은 개발자의 결정적으로 집계된 AI 사용 통계(사실 블록)를 받아 '이번 주 이렇게 썼다'를 짧은 한국어 산문으로 서술한다.",
  "규칙:",
  "- 사실 블록에 없는 수치·지표·성과를 절대 지어내지 말 것. 정량 주장은 블록의 값만 인용.",
  "- 블록에 명시된 값만 그대로 인용하고, 값들 간 계산(배수·합·평균 등)으로 새 수치를 만들지 말 것.",
  "- 서술이지 평가가 아니다 — '잘 썼다'가 아니라 '이렇게 썼다'. 토큰은 양이지 실력이 아니다.",
  "- 한국어 산문 2~4문장. 머리말·맺음말 없이.",
  "- 표는 문서에 남으므로 숫자 나열이 아니라 패턴 해석에 집중.",
].join("\n");

export interface AnthropicSummarizerOptions {
  model?: string;
  maxTokens?: number;
  /** 테스트·주입용. 미지정 시 env에서 읽는다. */
  apiKey?: string;
}

/** 시스템 프롬프트 + 유저 프레이밍 + 모델 env 키를 받아 Summarizer를 만든다. */
function makeAnthropicCaller(
  system: string,
  frame: (maskedContext: string) => string,
  modelEnvVar: string,
  opts: AnthropicSummarizerOptions,
): Summarizer {
  const model = opts.model ?? process.env[modelEnvVar] ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 1024;

  return async (maskedContext: string): Promise<string> => {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new SummarizerError("no-api-key", "ANTHROPIC_API_KEY가 설정되지 않았습니다.");
    }

    const client = new Anthropic({ apiKey });
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: frame(maskedContext) }],
      });
    } catch (err) {
      throw new SummarizerError("transport", `Anthropic 호출 실패: ${(err as Error).message}`);
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock || textBlock.text.trim() === "") {
      throw new SummarizerError("empty", "모델 응답에 텍스트가 없습니다.");
    }
    return textBlock.text;
  };
}

/** "어제 한 일" 요약기(스크럼용). env: AIMM_SUMMARY_MODEL. */
export function createAnthropicSummarizer(opts: AnthropicSummarizerOptions = {}): Summarizer {
  return makeAnthropicCaller(SUMMARY_SYSTEM_PROMPT, (ctx) => `어제 커밋 목록:\n${ctx}`, "AIMM_SUMMARY_MODEL", opts);
}

/** 주간 사용 내레이터(분석용). env: AIMM_NARRATIVE_MODEL. */
export function createAnthropicNarrator(opts: AnthropicSummarizerOptions = {}): Summarizer {
  return makeAnthropicCaller(NARRATIVE_SYSTEM_PROMPT, (ctx) => `사용 통계(사실 블록):\n${ctx}`, "AIMM_NARRATIVE_MODEL", opts);
}
