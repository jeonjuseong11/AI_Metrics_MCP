/**
 * 렌더 — 집계 메트릭을 사람이 읽는 마크다운 블록으로.
 *
 * 메트릭은 결정적으로 계산된 값을 "그대로 주입"한다(LLM 우회, 부록 A A4).
 * 비용 표기에는 항상 "추정·정산액 아님" 단서를 붙인다(§6).
 */

import type { AggregatedMetrics, ModelMetric } from "./metrics.js";
import { PRICING_TABLE_VERSION } from "../pricing.js";
import type { Commit } from "../parse/git.js";

/** 모델 ID → 짧은 표시명. "claude-opus-4-8" → "Opus". */
export function shortModelName(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return model;
}

/** 토큰 수를 "38k" 형태로. 1000 미만은 그대로. */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** ms → "2.7h" / "45m" 형태(지속 추정). */
export function formatDuration(ms: number): string {
  const minutes = ms / 60000;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes)}m`;
}

/** 한 모델의 "프롬프트+캐시 읽기"를 합산한 표시용 토큰(어떤 모델을 얼마나 썼나). */
function displayTokens(m: ModelMetric): number {
  return m.tokens.input + m.tokens.output + m.tokens.cacheRead + m.tokens.cacheCreation;
}

/**
 * §4.2 산출물 예시의 "AI 사용 메트릭" 블록을 만든다.
 */
export function renderMetricsBlock(agg: AggregatedMetrics): string {
  if (agg.sessionCount === 0 || agg.byModel.length === 0) {
    return "## AI 사용 메트릭 (자동 추출)\n- 기록된 AI 세션 없음";
  }

  const perModel = agg.byModel
    .map((m) => `${shortModelName(m.model)} ${formatTokens(displayTokens(m))} tok`)
    .join(" · ");

  const duration = formatDuration(agg.totalDurationMs);
  const cost = `$${agg.totalCostUsd.toFixed(2)}`;
  const unknownNote = agg.hasUnknownModel ? " (일부 모델 단가 미상 — 비용 미반영)" : "";

  return [
    "## AI 사용 메트릭 (자동 추출)",
    `- 모델: ${perModel}  |  세션 ${agg.sessionCount}건, 지속(추정) ${duration}`,
    `- 추정 비용: 약 ${cost} (토큰×공시 단가 v${PRICING_TABLE_VERSION} 기준, 정산액 아님${unknownNote})`,
  ].join("\n");
}

export interface DraftOptions {
  date: string;
  author?: string;
  /** LLM 요약이 실패해 원시 활동만 첨부하는 폴백 모드(§4.4). */
  generationFailed?: boolean;
}

/** 커밋 1개를 "어제 한 일" 항목으로(커밋 해시 근거 표기, §4.2). */
function renderCommitItem(c: Commit): string {
  return `- ${c.subject}\n  근거: \`${c.shortHash}\` ${c.subject}`;
}

/**
 * 일일 스크럼 초안 전체를 렌더한다.
 *
 * - 빈 날(커밋 0 + 세션 0): "기록된 활동 없음" graceful 출력(§4.4).
 * - 부분 데이터: 있는 것만 렌더.
 * - generationFailed: 원시 커밋 목록만 + 가시적 에러 노트(§4.4).
 * - 메트릭은 결정적 계산값을 그대로 주입(LLM 우회).
 */
export function renderDraft(commits: Commit[], metrics: AggregatedMetrics, opts: DraftOptions): string {
  const author = opts.author ? ` (${opts.author})` : "";
  const header = `# 일일 스크럼 — ${opts.date}${author}`;

  const isEmpty = commits.length === 0 && metrics.sessionCount === 0;
  if (isEmpty) {
    return [header, "", "오늘 기록된 활동 없음", "", footer(opts)].join("\n");
  }

  const parts: string[] = [header, ""];

  if (opts.generationFailed) {
    parts.push("> ⚠️ 초안 생성(LLM 요약) 실패 — 원시 활동(커밋 목록)만 첨부합니다.", "");
  }

  parts.push("## 어제 한 일");
  if (commits.length === 0) {
    parts.push("- (커밋 기록 없음 — AI 세션만 있었음)");
  } else {
    for (const c of commits) parts.push(renderCommitItem(c));
  }
  parts.push("");

  parts.push(renderMetricsBlock(metrics), "");
  parts.push(footer(opts));
  return parts.join("\n");
}

function footer(opts: DraftOptions): string {
  const lines = [
    "---",
    "⚠️ 이 초안은 커밋·세션 로그 기반 자동 생성입니다. 수치·성과를 임의로 추가하지 않았으며,",
    "   메트릭은 로그 토큰에서 산출(활동 시간 아님), 세션은 시작 시각(KST) 기준 귀속, 제출 전 본인 검토가 필요합니다.",
  ];
  void opts;
  return lines.join("\n");
}
