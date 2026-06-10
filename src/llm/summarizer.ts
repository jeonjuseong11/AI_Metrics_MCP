/**
 * LLM 요약기 인터페이스 — 코어는 구체 SDK에 의존하지 않는다(DI).
 *
 * 실제 구현(anthropic.ts)은 이 인터페이스를 만족하고, 테스트는 가짜 요약기를
 * 주입한다. 덕분에 마스킹·폴백·승인 경로를 API 키 없이 전부 테스트할 수 있다.
 */

/** 마스킹을 거친 컨텍스트를 받아 "어제 한 일" 산문(마크다운)을 돌려준다. */
export type Summarizer = (maskedContext: string) => Promise<string>;

export type SummarizerErrorKind =
  | "no-api-key"
  | "timeout"
  | "empty"
  | "refusal"
  | "bad-output"
  | "transport";

/** 요약 실패는 항상 이 타입으로 던진다 → 호출부가 폴백 판단. */
export class SummarizerError extends Error {
  constructor(
    public readonly kind: SummarizerErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SummarizerError";
  }
}
