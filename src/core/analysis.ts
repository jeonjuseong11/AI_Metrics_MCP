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
import { summarizeContent, type ContentSummary } from "./content.js";
import { toKstDateString } from "./day.js";
import { PRICING_TABLE_VERSION } from "../pricing.js";
import type { NormalizedSession, SessionContentDigest, TokenTotals } from "../types.js";

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

/** 소스(도구)별 사용 집계. cost-unknown 소스(Cursor 등)는 비용을 "미상"으로 둔다. */
export interface ToolBucket {
  source: string;
  displayName: string;
  sessions: number;
  costUsd: number;
  /** providesCost. false면 렌더가 비용을 "미상"으로 표기. */
  costKnown: boolean;
}

/** source id → 표시명·비용제공여부. buildAnalysis가 어댑터 목록에서 구성해 analyze에 주입. */
export type SourceMeta = Map<string, { displayName: string; providesCost: boolean }>;

export interface UsageAnalysis {
  range: { start: string; end: string };
  totals: { sessions: number; tokens: TokenTotals; costUsd: number; durationMs: number };
  byModel: ModelShare[];
  byDay: DayBucket[];
  /** KST 0~23시 세션 시작 분포(길이 24). cost-known 소스만. */
  byHourKst: number[];
  byProject: ProjectBucket[];
  busiestDay: DayBucket | undefined;
  hasUnknownModel: boolean;
  pricingVersion: string;
  /** 소스(도구)별 집계. 단일 소스면 길이 1. 옵셔널(기존 픽스처 호환; analyze는 항상 채움). */
  byTool?: ToolBucket[];
  /** 세션 내용 요약(Claude Code cost-known만). content 있는 세션 없으면 생략. */
  contentSummary?: ContentSummary;
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

/**
 * 세션 목록 → 사용 분석. 순수·결정적.
 *
 * `sourceMeta`(소스 id → 비용제공여부)가 주어지면, **cost-unknown 소스(Cursor 등)는 모델/비용/시간 롤업에서
 * 제외**하고 byTool에만 반영한다. 이로써 Cursor의 0토큰·"unknown" 모델이 hasUnknownModel을 켜거나
 * 모델믹스·프로젝트에 유령 행을 만드는 오염을 차단한다. 미주입(빈 맵)이면 모든 소스가 cost-known(기존 동작).
 */
export function analyze(
  sessions: NormalizedSession[],
  opts: AnalyzeOptions = {},
  sourceMeta: SourceMeta = new Map(),
): UsageAnalysis {
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

  // cost-known 판정: 맵에 없으면 true(기존 단일 소스 동작 보존).
  const isCostKnown = (s: NormalizedSession): boolean => sourceMeta.get(s.source ?? "")?.providesCost ?? true;

  // 기존 롤업(모델·일자·시간대·프로젝트·총계·hasUnknownModel)은 cost-known 세션만.
  const inRangeKnown = inRange.filter((d) => isCostKnown(d.session));
  const knownSessions = inRangeKnown.map((d) => d.session);
  const allSessions = inRange.map((d) => d.session); // byTool·range용(전 소스)

  const overall = aggregate(knownSessions);
  const totalDisplay = metricsDisplayTokens(overall);

  // 내용 요약 — 전 소스(cost-unknown 포함). "무엇을 했나"는 활동 서술이지 비용이 아니므로
  // Cursor 등도 포함한다(v0.14.0에서 내용 격리 해제; 비용·모델·시간 롤업은 여전히 cost-known만).
  const contentDigests = allSessions
    .map((s) => s.content)
    .filter((c): c is SessionContentDigest => c !== undefined);
  const contentSummary = contentDigests.length > 0 ? summarizeContent(contentDigests) : undefined;

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

  // 일자별(cost-known).
  const dayMap = new Map<string, NormalizedSession[]>();
  for (const { session, kstDate } of inRangeKnown) {
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

  // 프로젝트별(cost-known).
  const projMap = new Map<string, NormalizedSession[]>();
  for (const session of knownSessions) {
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

  // 시간대(KST) 분포(cost-known).
  const byHourKst = new Array<number>(24).fill(0);
  for (const { session } of inRangeKnown) {
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

  // 도구별(전 소스). cost-unknown 소스는 비용 미상.
  const toolMap = new Map<string, NormalizedSession[]>();
  for (const session of allSessions) {
    groupPush(toolMap, session.source ?? "(unknown)", session);
  }
  const byTool: ToolBucket[] = [...toolMap.entries()]
    .map(([source, group]) => {
      const meta = sourceMeta.get(source);
      const costKnown = meta?.providesCost ?? true;
      return {
        source,
        displayName: meta?.displayName ?? source,
        sessions: group.length,
        costUsd: costKnown ? aggregate(group).totalCostUsd : 0,
        costKnown,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

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
    byTool,
    ...(contentSummary ? { contentSummary } : {}),
  };
}
