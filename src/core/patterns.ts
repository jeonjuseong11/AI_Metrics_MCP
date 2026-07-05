/**
 * 사용 패턴 발견 엔진(E2) — 세션 데이터만으로 "어떻게 쓰는지" 비자명 패턴.
 *
 * 순수·결정적(LLM·git 불요). 작은 n에서 거짓 패턴을 피하려 가드로 침묵한다.
 * 모든 관찰은 *서술*이지 통계적 단정·인과가 아니다.
 */

import type { UsageAnalysis } from "./analysis.js";
import type { Insight } from "./insight.js";
import { formatDuration } from "./render.js";
import { daysBetweenInclusive, WEEKDAY, weekdayOf, isoDatePlusDays } from "./day.js";

/** 기간 일수(inclusive). range 비면 활동일 수. */
function periodDays(a: UsageAnalysis): number {
  if (a.range.start && a.range.end) return daysBetweenInclusive(a.range.start, a.range.end);
  return a.byDay.length;
}

/** 중앙값(짝수면 두 중앙 평균). 빈 배열 0. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** 세션 데이터 기반 사용 패턴 발견. 가드 미달 축은 생략. */
export function derivePatterns(a: UsageAnalysis): Insight[] {
  const out: Insight[] = [];
  if (a.totals.sessions === 0) return out;

  const days = periodDays(a);

  // 1. 세션 케이던스 (항상)
  const avg = formatDuration(a.totals.durationMs / a.totals.sessions);
  const ratio = days > 0 ? a.byDay.length / days : 0;
  const qualifier = ratio < 0.3 ? "며칠에 몰아서" : ratio > 0.6 ? "꾸준히" : "";
  out.push({
    kind: "session-cadence",
    text: qualifier
      ? `평균 세션 약 ${avg}, 기간 ${days}일 중 ${a.byDay.length}일 활동 — ${qualifier} 작업하는 편입니다.`
      : `평균 세션 약 ${avg}, 기간 ${days}일 중 ${a.byDay.length}일 활동입니다.`,
  });

  // 2. 요일 리듬 (활동일 >= 3)
  if (a.byDay.length >= 3) {
    const totalS = a.byDay.reduce((s, x) => s + x.sessions, 0);
    const weekendS = a.byDay.reduce((s, x) => {
      const wd = weekdayOf(x.date);
      return wd === 0 || wd === 6 ? s + x.sessions : s;
    }, 0);
    const share = totalS > 0 ? weekendS / totalS : 0;
    if (share <= 0.1) {
      out.push({ kind: "weekday-rhythm", text: `주로 평일에 작업합니다 (주말 비중 ${pct(share)}).` });
    } else if (share >= 0.4) {
      out.push({ kind: "weekday-rhythm", text: `주말에도 활발합니다 (주말 비중 ${pct(share)}).` });
    } else {
      const byWd = new Array<number>(7).fill(0);
      for (const x of a.byDay) {
        const wd = weekdayOf(x.date);
        byWd[wd] = (byWd[wd] ?? 0) + x.sessions;
      }
      let arg = 0;
      for (let i = 1; i < 7; i++) if ((byWd[i] ?? 0) > (byWd[arg] ?? 0)) arg = i;
      out.push({ kind: "weekday-rhythm", text: `가장 활발한 요일은 ${WEEKDAY[arg]}요일입니다.` });
    }
  }

  // 3. 사용 추세 (기간 >= 6 AND 전·후반 둘 다 세션>0)
  if (days >= 6 && a.range.start) {
    const mid = isoDatePlusDays(a.range.start, Math.floor(days / 2));
    let first = 0;
    let second = 0;
    for (const x of a.byDay) {
      if (x.date < mid) first += x.sessions;
      else second += x.sessions;
    }
    if (first > 0 && second > 0) {
      const r = second / first;
      if (r >= 1.3) {
        out.push({ kind: "usage-trend", text: `후반부 사용이 전반부의 약 ${r.toFixed(1)}배 — 최근 더 자주 씁니다.` });
      } else if (r <= 0.77) {
        out.push({ kind: "usage-trend", text: `사용이 줄고 있습니다 (후반부가 전반부의 약 ${r.toFixed(1)}배).` });
      } else {
        out.push({ kind: "usage-trend", text: `사용이 대체로 꾸준합니다.` });
      }
    }
  }

  // 4. 비용 급증일 (활동일 >= 4 AND 중앙값 > 0)
  if (a.byDay.length >= 4) {
    const med = median(a.byDay.map((x) => x.costUsd));
    if (med > 0) {
      const spikes = a.byDay.filter((x) => x.costUsd > 2 * med).sort((x, y) => y.costUsd - x.costUsd);
      if (spikes.length > 0) {
        const top = spikes.slice(0, 2);
        const maxR = (top[0]?.costUsd ?? 0) / med;
        out.push({
          kind: "cost-spike",
          text: `비용이 튄 날: ${top.map((x) => x.date).join(", ")} (평소 중앙값 $${med.toFixed(2)}의 최대 약 ${maxR.toFixed(1)}배).`,
        });
      }
    }
  }

  return out;
}
