/**
 * 개인 AI 사용 분석 — 결정적 롤업(주간/월간).
 *
 * "내가 평소에 AI를 어떻게 쓰는지"를 지표로 보여주는 분석 문서의 데이터 계층.
 * 전부 결정적 계산(LLM 우회). 메트릭 코어(aggregate)를 재사용한다.
 *
 * 단서: 이 분석은 *서술*(이렇게 쓴다)이지 *평가*(잘 쓴다)가 아니다.
 * 토큰·빈도는 양이지 실력이 아니다 — "셀프 리뷰 자료"로 본다.
 */

import { aggregate, type AggregatedMetrics } from "./metrics.js";
import { toKstDateString } from "./day.js";
import { PRICING_TABLE_VERSION } from "../pricing.js";
import type { NormalizedSession, TokenTotals } from "../types.js";

export interface ModelShare {
  model: string;
  displayTokens: number;
  costUsd: number;
  /** 토큰 비중(0~1). */
  tokenShare: number;
  /** 비용 비중(0~1). */
  costShare: number;
}

export interface DayBucket {
  date: string; // KST YYYY-MM-DD
  sessions: number;
  displayTokens: number;
  costUsd: number;
}

export interface ProjectBucket {
  project: string;
  sessions: number;
  displayTokens: number;
  costUsd: number;
}

export interface UsageAnalysis {
  range: { start: string; end: string };
  totals: { sessions: number; tokens: TokenTotals; costUsd: number; durationMs: number };
  byModel: ModelShare[];
  byDay: DayBucket[];
  /** KST 0~23시 세션 시작 분포(길이 24). */
  byHourKst: number[];
  byProject: ProjectBucket[];
  busiestDay: DayBucket | undefined;
  hasUnknownModel: boolean;
  pricingVersion: string;
}

function displayTokensOf(t: TokenTotals): number {
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}

/** Map<key, T[]>에 값 추가(없으면 생성). */
function groupPush<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function metricsDisplayTokens(agg: AggregatedMetrics): number {
  return displayTokensOf(agg.totals);
}

export interface AnalyzeOptions {
  /** KST 시작/끝 날짜(포함). 미지정 시 데이터에서 유도. */
  start?: string;
  end?: string;
}

/** 세션 목록 → 사용 분석. 순수·결정적. */
export function analyze(sessions: NormalizedSession[], opts: AnalyzeOptions = {}): UsageAnalysis {
  // 시작 시각 있는 세션만, 시작 시각의 KST 날짜로 귀속.
  const dated = sessions
    .filter((s): s is NormalizedSession & { startTime: Date } => s.startTime !== undefined)
    .map((s) => ({ session: s, kstDate: toKstDateString(s.startTime) }));

  const inRange = dated.filter(({ kstDate }) => {
    if (opts.start && kstDate < opts.start) return false;
    if (opts.end && kstDate > opts.end) return false;
    return true;
  });

  const dates = inRange.map((d) => d.kstDate).sort();
  const rangeStart = opts.start ?? dates[0] ?? "";
  const rangeEnd = opts.end ?? dates[dates.length - 1] ?? "";

  const rangeSessions = inRange.map((d) => d.session);
  const overall = aggregate(rangeSessions);
  const totalDisplay = metricsDisplayTokens(overall);

  // 모델 비중.
  const byModel: ModelShare[] = overall.byModel.map((m) => {
    const dt = displayTokensOf(m.tokens);
    return {
      model: m.model,
      displayTokens: dt,
      costUsd: m.costUsd,
      tokenShare: totalDisplay > 0 ? dt / totalDisplay : 0,
      costShare: overall.totalCostUsd > 0 ? m.costUsd / overall.totalCostUsd : 0,
    };
  });

  // 일자별.
  const dayMap = new Map<string, NormalizedSession[]>();
  for (const { session, kstDate } of inRange) {
    groupPush(dayMap, kstDate, session);
  }
  const byDay: DayBucket[] = [...dayMap.keys()].sort().map((date) => {
    const agg = aggregate(dayMap.get(date)!);
    return {
      date,
      sessions: agg.sessionCount,
      displayTokens: metricsDisplayTokens(agg),
      costUsd: agg.totalCostUsd,
    };
  });

  // 프로젝트별.
  const projMap = new Map<string, NormalizedSession[]>();
  for (const session of rangeSessions) {
    groupPush(projMap, session.projectPath ?? "(unknown)", session);
  }
  const byProject: ProjectBucket[] = [...projMap.keys()]
    .map((project) => {
      const agg = aggregate(projMap.get(project)!);
      return {
        project,
        sessions: agg.sessionCount,
        displayTokens: metricsDisplayTokens(agg),
        costUsd: agg.totalCostUsd,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.displayTokens - a.displayTokens);

  // 시간대(KST) 분포.
  const byHourKst = new Array<number>(24).fill(0);
  for (const { session } of inRange) {
    const kstHour = new Date(session.startTime.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
    byHourKst[kstHour] = (byHourKst[kstHour] ?? 0) + 1;
  }

  // 가장 활발한 날(비용 기준, 동률이면 토큰).
  let busiestDay: DayBucket | undefined;
  for (const d of byDay) {
    if (
      !busiestDay ||
      d.costUsd > busiestDay.costUsd ||
      (d.costUsd === busiestDay.costUsd && d.displayTokens > busiestDay.displayTokens)
    ) {
      busiestDay = d;
    }
  }

  return {
    range: { start: rangeStart, end: rangeEnd },
    totals: {
      sessions: overall.sessionCount,
      tokens: overall.totals,
      costUsd: overall.totalCostUsd,
      durationMs: overall.totalDurationMs,
    },
    byModel,
    byDay,
    byHourKst,
    byProject,
    busiestDay,
    hasUnknownModel: overall.hasUnknownModel,
    pricingVersion: PRICING_TABLE_VERSION,
  };
}
