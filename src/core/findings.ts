/**
 * 발견 합성 — E1 미니 인사이트 + E2 사용 패턴을 초상 `## 발견`용으로 합친다.
 * 순서: 패턴 먼저(더 흥미로운 "어떻게 쓰는지"), 그다음 E1. 비용 이중표기 정리. 상한 5.
 */

import type { UsageAnalysis } from "./analysis.js";
import { deriveInsights, type Insight } from "./insight.js";
import { derivePatterns } from "./patterns.js";

const MAX_FINDINGS = 5;

/** 초상 `## 발견`에 들어갈 최종 발견 목록. */
export function deriveFindings(a: UsageAnalysis): Insight[] {
  const pattern = derivePatterns(a);
  let mini = deriveInsights(a);
  // cost-spike가 있으면 E1 cost-concentration 제거(비용 이중표기 방지).
  if (pattern.some((p) => p.kind === "cost-spike")) {
    mini = mini.filter((m) => m.kind !== "cost-concentration");
  }
  return [...pattern, ...mini].slice(0, MAX_FINDINGS);
}
