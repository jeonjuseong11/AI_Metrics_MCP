/**
 * craft 초상(E1) 렌더 — 공유 가능한 AI 사용 스냅샷.
 *
 * analyze 덤프와 달리 외부 독자용·텍스트+표만(막대/스파크라인 없음)·5필드 큐레이션.
 * 프로젝트명은 절대 렌더하지 않는다(개수만). 결정적(LLM 우회).
 */

import type { UsageAnalysis } from "./analysis.js";
import { shortModelName } from "./render.js";
import { deriveFindings } from "./findings.js";
import { daysBetweenInclusive } from "./day.js";

export interface PortraitOptions {
  author?: string;
  /** "· 생성 <date>" 라벨. CLI가 KST 오늘 날짜 주입. 없으면 생략. */
  generatedDate?: string;
}

/** 천단위 콤마 + 소수 2자리. 3434.04 → "$3,434.04". */
function formatMoney(usd: number): string {
  const fixed = usd.toFixed(2);
  const dot = fixed.indexOf(".");
  const whole = fixed.slice(0, dot);
  const frac = fixed.slice(dot + 1);
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${frac}`;
}

/** 토큰 비중 최대 패밀리 + 비중(0~1). 동률은 이름 코드유닛 비교. */
function topModel(a: UsageAnalysis): { name: string; share: number } | undefined {
  const fam = new Map<string, number>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    fam.set(name, (fam.get(name) ?? 0) + m.tokenShare);
  }
  const sorted = [...fam.entries()].sort(
    (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0),
  );
  const t = sorted[0];
  return t ? { name: t[0], share: t[1] } : undefined;
}

/** range(YYYY-MM-DD~YYYY-MM-DD)의 inclusive 일수. 빈 문자열이면 활동일 수로 폴백. */
function periodDays(a: UsageAnalysis): number {
  const { start, end } = a.range;
  if (!start || !end) return a.byDay.length;
  return daysBetweenInclusive(start, end);
}

const DAY_PARTS: Array<{ from: number; to: number; label: string }> = [
  { from: 0, to: 5, label: "새벽" },
  { from: 6, to: 11, label: "아침" },
  { from: 12, to: 17, label: "오후" },
  { from: 18, to: 20, label: "저녁" },
  { from: 21, to: 23, label: "밤" },
];

function dayPart(hour: number): string {
  for (const p of DAY_PARTS) if (hour >= p.from && hour <= p.to) return p.label;
  return "";
}

/** 최빈 시작시각 구간을 한국어로. "밤 21~23시" / "밤 22시 전후". */
function peakWindow(byHourKst: number[]): string {
  const peak = Math.max(...byHourKst);
  if (peak <= 0) return "기록 없음";
  let m = 0;
  for (let h = 0; h < 24; h++) {
    if (byHourKst[h] === peak) { m = h; break; }
  }
  let lo = m;
  let hi = m;
  if (m - 1 >= 0 && (byHourKst[m - 1] ?? 0) >= peak / 2) lo = m - 1;
  if (m + 1 <= 23 && (byHourKst[m + 1] ?? 0) >= peak / 2) hi = m + 1;
  const part = dayPart(m);
  return lo === hi ? `${part} ${m}시 전후` : `${part} ${lo}~${hi}시`;
}

/** craft 초상 마크다운을 렌더한다(공유용·결정적). */
export function renderPortrait(a: UsageAnalysis, opts: PortraitOptions = {}): string {
  const who = opts.author ? ` — ${opts.author}` : "";
  const gen = opts.generatedDate ? ` · 생성 ${opts.generatedDate}` : "";
  const lines: string[] = [];
  lines.push(`# AI Craft 초상${who}`);
  lines.push(`기간: ${a.range.start} ~ ${a.range.end} (KST)${gen}`);
  lines.push("");

  if (a.totals.sessions === 0) {
    const toolTotal = (a.byTool ?? []).reduce((n, t) => n + t.sessions, 0);
    if (toolTotal === 0) {
      lines.push("이 기간에 기록된 AI 세션이 없습니다.");
      lines.push("");
      lines.push("---");
      lines.push("⚠️ *서술*이며 *평가* 아님. 로컬 생성·본인 소유.");
      return lines.join("\n");
    }
    // 비용-미상 소스(Cursor 등)만 활동 — "세션 없음" 거짓 대신 도구별 표를 보여준다(honest snapshot).
    lines.push("비용·토큰을 측정할 수 있는 소스(Claude Code) 기록이 이 기간에 없습니다. 아래는 시간·빈도만 잡히는 소스입니다.");
    lines.push("");
    lines.push("## 도구별 사용");
    lines.push("| 도구 | 세션 | 추정 비용 |");
    lines.push("|------|------|-----------|");
    for (const t of a.byTool ?? []) {
      lines.push(`| ${t.displayName} | ${t.sessions} | ${t.costKnown ? `약 ${formatMoney(t.costUsd)}` : "미상"} |`);
    }
    lines.push("_세션 정의는 도구마다 다릅니다: Claude Code=세션 로그, Cursor=대화(composer)._");
    lines.push("");
    lines.push("---");
    lines.push("⚠️ *서술*이며 *평가* 아님. 로컬 생성·본인 소유.");
    return lines.join("\n");
  }

  lines.push("> 내가 AI를 실제로 어떻게 쓰는지의 정직한 스냅샷. 평가가 아니라 서술입니다.");
  lines.push("");

  const unknownNote = a.hasUnknownModel ? " (일부 모델 단가 미상)" : "";
  const tm = topModel(a);
  const tmCell = tm ? `${tm.name} (토큰 ${Math.round(tm.share * 100)}%)` : "—";

  lines.push("## 한눈에");
  lines.push("| 항목 | 값 |");
  lines.push("|------|-----|");
  lines.push(`| 활동 | ${periodDays(a)}일 중 ${a.byDay.length}일 |`);
  lines.push(`| AI 세션 | ${a.totals.sessions}건 |`);
  lines.push(`| 추정 비용 | 약 ${formatMoney(a.totals.costUsd)}${unknownNote} |`);
  lines.push(`| 주력 모델 | ${tmCell} |`);
  lines.push(`| 프로젝트 | ${a.byProject.length}개에 걸쳐 사용 |`);
  lines.push("");

  lines.push("## 도구별 사용");
  lines.push("| 도구 | 세션 | 추정 비용 |");
  lines.push("|------|------|-----------|");
  // analyze는 production에서 항상 byTool을 채운다. 이 fallback은 byTool 없는 손수 픽스처·back-compat 전용
  // (이 분기에 닿을 땐 sessions>0이고 cost-known 단일 소스 = Claude Code 가정).
  const tools =
    a.byTool && a.byTool.length > 0
      ? a.byTool
      : [{ source: "claude-code", displayName: "Claude Code", sessions: a.totals.sessions, costUsd: a.totals.costUsd, costKnown: true }];
  for (const t of tools) {
    lines.push(`| ${t.displayName} | ${t.sessions} | ${t.costKnown ? `약 ${formatMoney(t.costUsd)}` : "미상"} |`);
  }
  if (tools.length > 1) {
    lines.push("_세션 정의는 도구마다 다릅니다: Claude Code=세션 로그, Cursor=대화(composer)._");
  }
  lines.push("");

  lines.push("## 비용 요약");
  lines.push("| 항목 | 값 |");
  lines.push("|------|-----|");
  lines.push(`| 총 추정 | 약 ${formatMoney(a.totals.costUsd)} |`);
  if (a.busiestDay) {
    lines.push(`| 가장 활발한 날 | ${a.busiestDay.date} (약 ${formatMoney(a.busiestDay.costUsd)}) |`);
  }
  const avg = a.byDay.length > 0 ? a.totals.costUsd / a.byDay.length : 0;
  lines.push(`| 활동일 평균 | 약 ${formatMoney(avg)}/일 |`);
  lines.push("");

  lines.push("## 발견");
  for (const ins of deriveFindings(a)) lines.push(`- ${ins.text}`);
  lines.push(`> 결정적 관찰(활동일 ${a.byDay.length}일 기준). 추세·상관 서술이지 통계적 단정·인과가 아닙니다.`);
  lines.push("");

  lines.push("## 시간대 패턴");
  lines.push(`주로 **${peakWindow(a.byHourKst)}**에 사용합니다 (세션 시작 KST 최빈 구간).`);
  lines.push("");

  lines.push("## 본인 메모");
  lines.push("_(이 줄을 지우고, 이 기간 자랑할 작업·맥락을 직접 적으세요.)_");
  lines.push("");

  lines.push("---");
  lines.push(
    `⚠️ *서술*이며 *평가* 아님. 토큰·세션은 양이지 실력이 아닙니다. 비용은 추정치(단가 v${a.pricingVersion}, 정산액 아님). 로컬 생성·본인 소유.`,
  );
  return lines.join("\n");
}
