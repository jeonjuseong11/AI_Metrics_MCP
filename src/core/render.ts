/**
 * 렌더 — 집계 메트릭을 사람이 읽는 마크다운 블록으로.
 *
 * 메트릭은 결정적으로 계산된 값을 "그대로 주입"한다(LLM 우회, 부록 A A4).
 * 비용 표기에는 항상 "추정·정산액 아님" 단서를 붙인다(§6).
 */

import type { AggregatedMetrics, ModelMetric } from "./metrics.js";
import { PRICING_TABLE_VERSION } from "../pricing.js";
import type { Commit } from "../parse/git.js";
import type { UsageAnalysis } from "./analysis.js";
import { labelCommitType, type SituationSummary } from "./situation.js";
import { OTHER } from "./content.js";

/** 모델 ID → 짧은 표시명. "claude-opus-4-8" → "Opus". */
export function shortModelName(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return model;
}

/** 토큰 수를 "420M" / "38k" 형태로. 1000 미만은 그대로. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
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

  // 짧은 이름(Opus/Sonnet/Haiku)으로 합산해 버전 중복 표기를 없앤다.
  const familyTokens = new Map<string, number>();
  for (const m of agg.byModel) {
    const name = shortModelName(m.model);
    familyTokens.set(name, (familyTokens.get(name) ?? 0) + displayTokens(m));
  }
  const perModel = [...familyTokens.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, tok]) => `${name} ${formatTokens(tok)} tok`)
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
  /** LLM이 생성한 "어제 한 일" 산문. 있으면 커밋 목록 대신 이걸 렌더(근거 해시는 함께 표기). */
  accomplishments?: string;
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
  if (opts.accomplishments && opts.accomplishments.trim() !== "") {
    parts.push(opts.accomplishments.trim());
    if (commits.length > 0) {
      parts.push("", `_근거 커밋: ${commits.map((c) => `\`${c.shortHash}\``).join(", ")}_`);
    }
  } else if (commits.length === 0) {
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

// ── 한 줄 거울(SessionStart) ────────────────────────────────────────────────

export interface GlanceInput {
  yesterday: UsageAnalysis;
  week: UsageAnalysis;
  /** 이번주 가장 바쁜 요일 라벨(예 "화"). 없으면 생략. */
  weekBusiestWeekday?: string;
}

/** 한 줄 거울(SessionStart 표출). 닫힌 어휘·숫자만. */
export function renderGlance(input: GlanceInput): string {
  const { yesterday, week, weekBusiestWeekday } = input;
  const yCost = `$${yesterday.totals.costUsd.toFixed(2)}`;
  const wCost = `$${week.totals.costUsd.toFixed(2)}`;

  if (yesterday.totals.sessions === 0) {
    if (week.totals.sessions === 0) return "🪞 아직 기록 없음 — 다음 세션부터 쌓임";
    return `🪞 어제 기록 없음 · 이번주(최근7일) ${week.totals.sessions}세션 · ${wCost}`;
  }

  const mix = (yesterday.contentSummary?.activity ?? [])
    .slice(0, 3)
    .map((a) => `${a.category}${(a.share * 100).toFixed(0)}%`)
    .join("·");
  const yPart = `🪞 어제: ${yesterday.totals.sessions}세션 · ${yCost}${mix ? ` · ${mix}` : ""}`;
  const busiest = weekBusiestWeekday ? ` · 가장 바쁜 요일 ${weekBusiestWeekday}` : "";
  const wPart = `이번주(최근7일): ${week.totals.sessions}세션 · ${wCost}${busiest}`;
  return `${yPart}  |  ${wPart}`;
}

// ── 개인 사용 분석 문서 렌더 ──────────────────────────────────────────────

/** 비율(0~1)을 너비 width의 막대로. */
function bar(share: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

function pct(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

/** 정수 천단위 콤마(결정적 — toLocaleString 비사용). 1800 → "1,800". */
function commaInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 프로젝트 슬러그를 읽기 쉽게: "...GitHub-AIWS-Front" → "AIWS-Front". */
export function prettyProject(slug: string): string {
  const marker = "GitHub-";
  const i = slug.indexOf(marker);
  const tail = i >= 0 ? slug.slice(i + marker.length) : slug;
  return tail.length > 40 ? tail.slice(-40) : tail;
}

/** 24슬롯 시간대 분포를 한 줄 스파크라인으로. */
function hourSparkline(byHour: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█";
  const max = Math.max(1, ...byHour);
  return byHour
    .map((c) => {
      if (c === 0) return "·";
      const idx = Math.min(blocks.length - 1, Math.floor((c / max) * (blocks.length - 1)));
      return blocks[idx];
    })
    .join("");
}

/**
 * 개인 AI 사용 분석 문서를 렌더한다(서술 자료, 평가 아님).
 */
export function renderAnalysis(a: UsageAnalysis, author?: string, narrative?: string, situation?: SituationSummary): string {
  const who = author ? ` — ${author}` : "";
  const lines: string[] = [];
  lines.push(`# AI 사용 분석${who}`);
  lines.push(`기간: ${a.range.start} ~ ${a.range.end} (KST)`);
  lines.push("");

  if (a.totals.sessions === 0) {
    const toolTotal = (a.byTool ?? []).reduce((n, t) => n + t.sessions, 0);
    if (toolTotal === 0) {
      lines.push("이 기간에 기록된 AI 세션이 없습니다.");
      return lines.join("\n");
    }
    // 비용-측정 가능 소스(Claude Code)는 없지만 비용-미상 소스(Cursor 등) 활동은 있음
    // → "세션 없음" 거짓 메시지 대신 도구별만 정직하게(honest snapshot).
    lines.push("비용·토큰을 측정할 수 있는 소스(Claude Code) 기록이 이 기간에 없습니다. 아래는 시간·빈도만 잡히는 소스입니다.");
    lines.push("");
    lines.push("## 도구별 사용");
    for (const t of a.byTool ?? []) {
      lines.push(`- ${t.displayName}: 세션 ${t.sessions} · ${t.costKnown ? `약 $${t.costUsd.toFixed(2)}` : "비용 미상"}`);
    }
    lines.push("_세션 정의는 도구마다 다릅니다: Claude Code=세션 로그, Cursor=대화(composer)._");
    return lines.join("\n");
  }

  // 주간 내러티브(옵션) — 결정적 표보다 앞에 둬 한눈에 읽히게. 표는 아래 남아 대조 검증.
  if (narrative && narrative.trim() !== "") {
    lines.push("## 한 주 돌아보기");
    lines.push(narrative.trim());
    lines.push("");
    lines.push("> ⚠️ 결정적 집계를 *서술*한 것이며 새 수치를 만들지 않습니다.");
    lines.push("");
  }

  // 요약.
  const unknownNote = a.hasUnknownModel ? " (일부 모델 단가 미상)" : "";
  lines.push("## 요약");
  lines.push(`- 세션 ${a.totals.sessions}건 · 활동일 ${a.byDay.length}일 · 지속(추정) ${formatDuration(a.totals.durationMs)}`);
  lines.push(`- 총 토큰 ${formatTokens(a.totals.tokens.input + a.totals.tokens.output + a.totals.tokens.cacheRead + a.totals.tokens.cacheCreation)} · 추정 비용 약 $${a.totals.costUsd.toFixed(2)}${unknownNote}`);
  if (a.busiestDay) {
    lines.push(`- 가장 활발한 날: ${a.busiestDay.date} (약 $${a.busiestDay.costUsd.toFixed(2)})`);
  }
  lines.push("");

  // 모델 믹스 — 짧은 이름(Opus/Sonnet/Haiku)으로 합산해 버전 중복 줄을 없앤다.
  lines.push("## 모델 믹스");
  const familyMap = new Map<string, { tokens: number; cost: number; tokenShare: number; costShare: number }>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    const cur = familyMap.get(name) ?? { tokens: 0, cost: 0, tokenShare: 0, costShare: 0 };
    cur.tokens += m.displayTokens;
    cur.cost += m.costUsd;
    cur.tokenShare += m.tokenShare;
    cur.costShare += m.costShare;
    familyMap.set(name, cur);
  }
  const families = [...familyMap.entries()].sort((x, y) => y[1].tokenShare - x[1].tokenShare);
  for (const [name, f] of families) {
    lines.push(`- ${name.padEnd(7)} ${bar(f.tokenShare)} ${pct(f.tokenShare)} 토큰 · $${f.cost.toFixed(2)} (${pct(f.costShare)} 비용)`);
  }
  lines.push("");

  // 일자별 추세(비용).
  lines.push("## 일자별 (추정 비용)");
  const maxDayCost = Math.max(...a.byDay.map((d) => d.costUsd), 0.0001);
  for (const d of a.byDay) {
    lines.push(`- ${d.date}  ${bar(d.costUsd / maxDayCost, 16)}  $${d.costUsd.toFixed(2)} · 세션 ${d.sessions}`);
  }
  lines.push("");

  // 시간대.
  lines.push("## 시간대 분포 (세션 시작, KST 0~23시)");
  lines.push("```");
  lines.push(`0         9         18      23`);
  lines.push(hourSparkline(a.byHourKst));
  lines.push("```");
  lines.push("");

  // 프로젝트별.
  lines.push("## 프로젝트별");
  for (const p of a.byProject) {
    lines.push(`- ${prettyProject(p.project)} — 세션 ${p.sessions} · $${p.costUsd.toFixed(2)}`);
  }
  lines.push("");

  // 도구별 사용(멀티소스). 단일 도구면 생략. cost-unknown 소스(Cursor)는 "비용 미상".
  const tools = a.byTool ?? [];
  if (tools.length > 1) {
    lines.push("## 도구별 사용");
    for (const t of tools) {
      lines.push(`- ${t.displayName}: 세션 ${t.sessions} · ${t.costKnown ? `약 $${t.costUsd.toFixed(2)}` : "비용 미상"}`);
    }
    lines.push("_세션 정의는 도구마다 다릅니다: Claude Code=세션 로그, Cursor=대화(composer)._");
    lines.push("");
  }

  // 무엇을 했나(세션 내용) — 결정적, content 있을 때만(Claude Code).
  const cs = a.contentSummary;
  if (cs && cs.sessionsWithContent > 0) {
    lines.push("## 무엇을 했나 (세션 내용 기반)");
    const act = cs.activity.map((x) => `${x.category} ${pct(x.share)}`).join(" · ");
    if (act) lines.push(`- 활동: ${act}   (도구 호출 ${commaInt(cs.totalToolUses)}건 기준)`);
    const TOP_AREAS = 6;
    const shownAreas = cs.areas.slice(0, TOP_AREAS);
    const extraAreas = cs.areas.length - shownAreas.length;
    const areaStr = shownAreas.map((x) => `${x.area} ${x.count}`).join(" · ");
    if (areaStr) lines.push(`- 다룬 영역: ${areaStr}${extraAreas > 0 ? ` · 외 ${extraAreas}개` : ""}`);
    const cmdStr = cs.commands
      .map((c) => (c.category === OTHER ? `기타 ${c.count}` : `${c.category}(${c.exampleVerbs.join("·")} ${c.count})`))
      .join(" · ");
    if (cmdStr) lines.push(`- 명령: ${cmdStr}`);
    lines.push(`- 대화 깊이: 사용자 요청 ~${cs.userPrompts}건 · 내용 분석된 세션 ${cs.sessionsWithContent}건`);
    lines.push("ℹ️ tool_use 빈도 기반 휴리스틱(무엇을 했나의 근사). Claude Code 세션만 분석(타 소스 내용 미파악).");
    lines.push("   메인 세션의 서브에이전트 디스패치만 셈 — 서브에이전트 내부 작업은 제외(무거우면 총량 과소).");
    lines.push("");
  }

  // 작업 성격(커밋 타입) — situation 있을 때만(--repo). 결정적, 정직성 라벨.
  if (situation && situation.total > 0) {
    lines.push("## 작업 성격 (커밋 타입)");
    for (const t of situation.byType) {
      lines.push(`- ${labelCommitType(t.type)} ${bar(t.share, 12)} ${pct(t.share)} (${t.count}건)`);
    }
    lines.push(
      `ℹ️ 커밋 ${situation.total}건을 conventional-commit 타입으로 분류(휴리스틱·평가 아님). ` +
        `AI 사용과의 연결은 같은 기간이라는 시간 추정이지 커밋별 증명이 아닙니다.`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("⚠️ 이 문서는 *서술*(어떻게 쓰는지)이며 *평가*(잘 쓰는지)가 아닙니다. 토큰·빈도는 양이지 실력이 아닙니다.");
  lines.push(`   비용은 추정치(단가 v${a.pricingVersion}, 정산액 아님), 세션 시간은 지속(추정)으로 활동 시간이 아닙니다.`);
  return lines.join("\n");
}
