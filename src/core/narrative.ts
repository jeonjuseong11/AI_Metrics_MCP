/**
 * 주간 내러티브의 전송 경계 — summarize.ts(커밋용)의 분석판.
 *
 *   분석 사실 ─▶ 사실 블록 빌드 ─▶ 마스킹(fail-closed) ─▶ [승인] ─▶ 내레이터 ─▶ 산문
 *
 * LLM에 보내는 것은 이미 결정적으로 계산된 집계 사실뿐. 산문은 그 숫자를
 * *서술*할 뿐 새 숫자를 만들지 않는다(결정적 메트릭은 LLM 우회).
 */

import { maskSecrets, type Redaction } from "./mask.js";
import { SummarizerError, type Summarizer } from "../llm/summarizer.js";
import { shortModelName, prettyProject } from "./render.js";
import type { UsageAnalysis } from "./analysis.js";
import type { SituationSummary } from "./situation.js";

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function totalDisplayTokens(a: UsageAnalysis): number {
  const t = a.totals.tokens;
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}

/**
 * 세션 시작 시간대(KST) 분포에서 피크 시각과 대략적 시간 띠를 서술.
 * 분포가 전부 0이면(시작 시각 있는 세션 없음) null — "피크 0시"를 거짓으로 내지 않는다.
 */
function peakHourPhrase(byHour: number[]): string | null {
  let peak = 0;
  for (let h = 1; h < byHour.length; h++) {
    if ((byHour[h] ?? 0) > (byHour[peak] ?? 0)) peak = h;
  }
  if ((byHour[peak] ?? 0) === 0) return null;
  const band = peak < 6 ? "새벽" : peak < 12 ? "오전" : peak < 18 ? "오후" : "저녁";
  return `피크 ${peak}시 (${band} 집중)`;
}

/** 결정적 분석 → LLM에 보낼 사실 블록(마스킹 전 원본). 지시문은 내레이터가 감싼다. */
export function buildNarrativeContext(a: UsageAnalysis, situation?: SituationSummary): string {
  const lines: string[] = [];
  lines.push(`[기간] ${a.range.start} ~ ${a.range.end} (KST)`);
  lines.push(`[총계] 세션 ${a.totals.sessions} · 활동일 ${a.byDay.length} · 비용 약 $${a.totals.costUsd.toFixed(2)}`);

  // 모델 패밀리(Opus/Sonnet/Haiku) 합산 — renderAnalysis와 동일 규칙.
  // 0토큰 항목(<synthetic> 등 Claude Code 내부 합성 모델)은 노이즈라 제외.
  const fam = new Map<string, { cost: number; tokenShare: number }>();
  for (const m of a.byModel) {
    if (m.displayTokens === 0) continue;
    const name = shortModelName(m.model);
    const cur = fam.get(name) ?? { cost: 0, tokenShare: 0 };
    cur.cost += m.costUsd;
    cur.tokenShare += m.tokenShare;
    fam.set(name, cur);
  }
  const models = [...fam.entries()]
    .sort((x, y) => y[1].tokenShare - x[1].tokenShare)
    .map(([name, f]) => `${name} ${pct(f.tokenShare)} 토큰/$${f.cost.toFixed(2)}`)
    .join(" · ");
  if (models) lines.push(`[모델믹스] ${models}`);

  const peak = peakHourPhrase(a.byHourKst);
  if (peak) lines.push(`[시간대] ${peak}`);

  // 프로젝트: 0토큰 제외 후 토큰 비중 상위 N개만(긴 0% 꼬리가 LLM을 오도하지 않게).
  // 잘린 개수는 "외 N개"로 정직하게 표기(은밀한 절단 금지).
  const TOP_PROJECTS = 6;
  const total = totalDisplayTokens(a);
  const ranked = a.byProject
    .filter((p) => p.displayTokens > 0)
    .sort((x, y) => y.displayTokens - x.displayTokens);
  const shown = ranked.slice(0, TOP_PROJECTS);
  const projects = shown
    .map((p) => `${prettyProject(p.project)} ${pct(total > 0 ? p.displayTokens / total : 0)}`)
    .join(" · ");
  if (projects) {
    const extra = ranked.length - shown.length;
    lines.push(`[프로젝트] ${projects}${extra > 0 ? ` · 외 ${extra}개` : ""}`);
  }

  if (a.busiestDay) {
    lines.push(`[가장 활발] ${a.busiestDay.date} ($${a.busiestDay.costUsd.toFixed(2)})`);
  }

  if (situation && situation.total > 0) {
    const types = situation.byType.map((t) => `${t.type} ${pct(t.share)}`).join(" · ");
    lines.push(`[작업성격] ${types} (커밋 ${situation.total}건, repo 기준)`);
  }
  return lines.join("\n");
}

export interface PreparedNarrative {
  /** 마스킹을 거쳐 실제로 전송될 사실 블록. */
  maskedContext: string;
  redactions: Redaction[];
}

/** 전송 준비: 사실 블록 빌드 + 마스킹(fail-closed). maskSecrets throw 시 전파(전송 차단). */
export function prepareNarrativeSend(a: UsageAnalysis, situation?: SituationSummary): PreparedNarrative {
  const raw = buildNarrativeContext(a, situation);
  const { masked, redactions } = maskSecrets(raw);
  return { maskedContext: masked, redactions };
}

export interface NarrativeResult {
  prose: string;
  redactions: Redaction[];
}

/**
 * 마스킹된 사실 블록을 내레이터에 보내 주간 산문을 얻는다.
 * 세션 0건/빈 응답은 SummarizerError, 그 외 실패는 그대로 전파 → 호출부 폴백.
 */
export async function narrateUsage(
  a: UsageAnalysis,
  narrator: Summarizer,
  situation?: SituationSummary,
): Promise<NarrativeResult> {
  if (a.totals.sessions === 0) {
    throw new SummarizerError("empty", "서술할 세션이 없습니다.");
  }
  const { maskedContext, redactions } = prepareNarrativeSend(a, situation);
  const prose = await narrator(maskedContext);
  if (typeof prose !== "string" || prose.trim() === "") {
    throw new SummarizerError("empty", "내레이터가 빈 응답을 반환했습니다.");
  }
  return { prose: prose.trim(), redactions };
}
