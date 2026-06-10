/**
 * 실제 Anthropic 요약기 — Summarizer 인터페이스 구현.
 *
 * 요약 모델은 저가 모델(기본 claude-haiku-4-5, 제안서 §7). 요약에 Opus 불필요.
 * 키는 환경변수 ANTHROPIC_API_KEY. 키가 없으면 SummarizerError('no-api-key').
 *
 * 입력(maskedContext)은 이미 마스킹을 거친 커밋 데이터다. 시스템 프롬프트로
 * "수치·성과 임의 생성 금지 + 근거 해시 표기"를 제약한다.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SummarizerError, type Summarizer } from "./summarizer.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = [
  "당신은 개발자의 어제 Git 커밋 목록을 받아 일일 스크럼의 '어제 한 일' 항목으로 간결히 요약한다.",
  "규칙:",
  "- 커밋에 없는 성과·수치·지표를 절대 지어내지 말 것.",
  "- 한국어, 불릿(- )으로. 관련 커밋을 묶어 자연스럽게.",
  "- 각 항목 끝에 근거 커밋 해시를 (해시) 형태로 표기.",
  "- 출력은 불릿 목록만. 머리말·맺음말 없이.",
].join("\n");

export interface AnthropicSummarizerOptions {
  model?: string;
  maxTokens?: number;
  /** 테스트·주입용. 미지정 시 env에서 읽는다. */
  apiKey?: string;
}

/** Anthropic 요약기를 만든다. 호출 시점에 키를 확인한다. */
export function createAnthropicSummarizer(opts: AnthropicSummarizerOptions = {}): Summarizer {
  const model = opts.model ?? process.env.AIMM_SUMMARY_MODEL ?? DEFAULT_MODEL;
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
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `어제 커밋 목록:\n${maskedContext}` }],
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
