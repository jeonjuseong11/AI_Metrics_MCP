/**
 * 메트릭 집계 — 결정적, LLM 우회 (부록 A "A4").
 *
 * 토큰·추정 비용·세션 지속시간은 전부 로컬에서 결정적으로 계산한다.
 * LLM은 이 숫자를 보거나 생성하지 않는다(환각 차단). 렌더 단계에서
 * 이 결과를 초안에 "그대로 주입"한다.
 *
 * "세션 지속시간"은 wall-clock(첫~끝 메시지 간격)이며 활동 시간이 아니다(§6).
 */

import { estimateCost, PRICING_TABLE_VERSION } from "../pricing.js";
import type { NormalizedSession, TokenTotals } from "../types.js";

export interface ModelMetric {
  model: string;
  tokens: TokenTotals;
  costUsd: number;
  unknownModel: boolean;
}

export interface AggregatedMetrics {
  byModel: ModelMetric[];
  totals: TokenTotals;
  totalCostUsd: number;
  sessionCount: number;
  /** 세션 wall-clock 합(추정). 활동 시간 아님. */
  totalDurationMs: number;
  /** 단가 테이블에 없는 모델이 하나라도 있었는가. */
  hasUnknownModel: boolean;
  pricingVersion: string;
}

function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function addInto(target: TokenTotals, src: TokenTotals): void {
  target.input += src.input;
  target.output += src.output;
  target.cacheRead += src.cacheRead;
  target.cacheCreation += src.cacheCreation;
}

/**
 * 세션 목록 → 집계 메트릭. 순수·결정적.
 */
export function aggregate(sessions: NormalizedSession[]): AggregatedMetrics {
  const byModelMap = new Map<string, TokenTotals>();
  const totals = emptyTotals();
  let totalDurationMs = 0;

  for (const session of sessions) {
    if (session.startTime && session.endTime) {
      totalDurationMs += session.endTime.getTime() - session.startTime.getTime();
    }
    for (const msg of session.messages) {
      const bucket = byModelMap.get(msg.model) ?? emptyTotals();
      addInto(bucket, msg.tokens);
      byModelMap.set(msg.model, bucket);
      addInto(totals, msg.tokens);
    }
  }

  // 결정적 순서: 모델 ID 사전순.
  const models = [...byModelMap.keys()].sort();
  const byModel: ModelMetric[] = [];
  let totalCostUsd = 0;
  let hasUnknownModel = false;

  for (const model of models) {
    const tokens = byModelMap.get(model) ?? emptyTotals();
    const cost = estimateCost(model, tokens);
    totalCostUsd += cost.usd;
    if (cost.unknownModel) hasUnknownModel = true;
    byModel.push({ model, tokens, costUsd: cost.usd, unknownModel: cost.unknownModel });
  }

  return {
    byModel,
    totals,
    totalCostUsd,
    sessionCount: sessions.length,
    totalDurationMs,
    hasUnknownModel,
    pricingVersion: PRICING_TABLE_VERSION,
  };
}
