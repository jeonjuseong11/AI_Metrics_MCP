/**
 * 미니 인사이트 — craft 초상(E1)의 결정적 관찰 계층.
 *
 * UsageAnalysis만으로 계산되는 사실 1~2개. 순수·결정적(LLM 우회).
 * 세션>0이면 최소 1개(model-focus)를 보장한다. E2가 git 상관 인사이트로 확장할 자리.
 * ④ 시간대는 portrait 렌더의 별도 섹션이라 여기 포함하지 않는다(중복 방지).
 */

import type { UsageAnalysis } from "./analysis.js";
import { shortModelName } from "./render.js";

export interface Insight {
  text: string;
  kind: "cost-concentration" | "model-focus";
}

/** 패밀리(Opus/Sonnet/Haiku)별 토큰 비중 최대. 동률은 이름 코드유닛 비교. */
function topModelFamily(a: UsageAnalysis): { name: string; tokenShare: number } | undefined {
  const fam = new Map<string, number>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    fam.set(name, (fam.get(name) ?? 0) + m.tokenShare);
  }
  const sorted = [...fam.entries()].sort(
    (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0),
  );
  const top = sorted[0];
  return top ? { name: top[0], tokenShare: top[1] } : undefined;
}

/** 결정적 미니 인사이트. 순서: [cost-concentration?, model-focus]. */
export function deriveInsights(a: UsageAnalysis): Insight[] {
  if (a.totals.sessions === 0) return [];
  const out: Insight[] = [];

  if (a.busiestDay && a.totals.costUsd > 0) {
    const share = a.busiestDay.costUsd / a.totals.costUsd;
    if (share >= 0.2) {
      out.push({
        kind: "cost-concentration",
        text: `비용의 약 ${Math.round(share * 100)}%가 단 하루(${a.busiestDay.date})에 집중됐습니다.`,
      });
    }
  }

  const top = topModelFamily(a);
  if (top) {
    const focus = top.tokenShare >= 0.8 ? " (단일 모델 집중)" : "";
    out.push({
      kind: "model-focus",
      text: `토큰의 ${Math.round(top.tokenShare * 100)}%를 ${top.name}로 썼습니다${focus}.`,
    });
  }

  return out;
}
