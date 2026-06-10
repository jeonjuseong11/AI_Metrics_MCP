/**
 * 모델 단가 테이블 (추정 비용 산출용).
 *
 * 리스크 대응(문서 §6 "추정 비용의 정확도"): 비용은 추정치이며 실제 청구액과
 * 다를 수 있다. 그래서 (a) 테이블에 버전을 박고, (b) 캐시 토큰을 별도 단가로
 * 반영하며, (c) 알 수 없는 모델은 비용 0 + unknown 플래그로 노출한다.
 *
 * 단가 모델(Anthropic 표준 구조):
 *   - input/output: 모델별 정가
 *   - cache_read  ≈ input 정가의 10%
 *   - cache_creation(write, 5분) ≈ input 정가의 125%
 */

import type { TokenTotals } from "./types.js";

export const PRICING_TABLE_VERSION = "2026-06-10";

/** USD per 1,000,000 tokens. */
interface ModelRate {
  input: number;
  output: number;
}

/** 모델 패밀리별 정가(추정). 실제 계약 단가로 교체 가능. */
const FAMILY_RATES: Record<string, ModelRate> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_CREATION_MULTIPLIER = 1.25;

/** 모델 ID → 패밀리 단가. 알 수 없으면 null. */
function rateForModel(model: string): ModelRate | null {
  const m = model.toLowerCase();
  for (const family of Object.keys(FAMILY_RATES)) {
    if (m.includes(family)) return FAMILY_RATES[family] ?? null;
  }
  return null;
}

export interface CostEstimate {
  usd: number;
  /** 단가 테이블에 없는 모델이라 비용에 반영 못 한 경우 true. */
  unknownModel: boolean;
}

/** 한 모델의 토큰 합 → 추정 비용(USD). 캐시 단가 반영. */
export function estimateCost(model: string, tokens: TokenTotals): CostEstimate {
  const rate = rateForModel(model);
  if (rate === null) return { usd: 0, unknownModel: true };
  const perToken = (rate.input || 0) / 1_000_000;
  const outPerToken = (rate.output || 0) / 1_000_000;
  const usd =
    tokens.input * perToken +
    tokens.output * outPerToken +
    tokens.cacheRead * perToken * CACHE_READ_MULTIPLIER +
    tokens.cacheCreation * perToken * CACHE_CREATION_MULTIPLIER;
  return { usd, unknownModel: false };
}
