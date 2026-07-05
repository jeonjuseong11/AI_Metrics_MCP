/**
 * SessionStart 거울 — stdin source 필터 + top-level systemMessage 출력.
 *
 * 스파이크 실측(CC v2.1.195): 사용자 표출은 **top-level `systemMessage`**.
 * `hookSpecificOutput.systemMessage`(nested)·`additionalContext`는 사용자 비표출.
 * 거울은 startup·resume에만(compact·clear 스킵 — 스팸 방지).
 */

import { buildAnalysis } from "./standup.js";
import { yesterdayKst, isoDatePlusDays, weekdayOf, WEEKDAY } from "./day.js";
import { renderGlance } from "./render.js";
import type { UsageAnalysis } from "./analysis.js";

export interface SessionStartOptions {
  now?: Date;
  /** 테스트 주입: 세션 파일 명시(빈 배열이면 자동 발견 스킵). */
  sessionFiles?: string[];
  /** 테스트 주입: projects 루트. */
  projectsDir?: string;
}

/** 이번주(byDay) 가장 바쁜 요일 라벨 — 세션 수 최다, 동률은 이른 요일(결정적). 없으면 undefined. */
function busiestWeekday(week: UsageAnalysis): string | undefined {
  if (week.byDay.length === 0) return undefined;
  const byWd = new Array<number>(7).fill(0);
  for (const d of week.byDay) { const i = weekdayOf(d.date); byWd[i] = (byWd[i] ?? 0) + d.sessions; }
  let best = -1;
  let bestN = 0;
  for (let wd = 0; wd < 7; wd++) {
    if ((byWd[wd] ?? 0) > bestN) {
      bestN = byWd[wd] ?? 0;
      best = wd;
    }
  }
  return best >= 0 ? WEEKDAY[best] : undefined;
}

/** SessionStart 거울 한 줄. 코어 재사용(claude-only cost-known). 실패해도 throw 안 함. */
export async function runSessionStart(opts: SessionStartOptions = {}): Promise<string> {
  try {
    const now = opts.now ?? new Date();
    const yDate = yesterdayKst(now);
    const weekStart = isoDatePlusDays(yDate, -6); // 최근 7일(어제 종료)

    const common: { sessionFiles?: string[]; projectsDir?: string } = {};
    if (opts.sessionFiles) common.sessionFiles = opts.sessionFiles;
    if (opts.projectsDir) common.projectsDir = opts.projectsDir;

    const [{ analysis: yesterday }, { analysis: week }] = await Promise.all([
      buildAnalysis({ ...common, start: yDate, end: yDate }),
      buildAnalysis({ ...common, start: weekStart, end: yDate }),
    ]);

    const input: import("./render.js").GlanceInput = { yesterday, week };
    const wd = busiestWeekday(week);
    if (wd) input.weekBusiestWeekday = wd;
    return renderGlance(input);
  } catch (err) {
    return failureGlance(err);
  }
}

/** 실패 폴백 메시지 — 닫힌 어휘 유지: 경로 구분자 제거 + non-Error 안전. */
export function failureGlance(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = raw.replace(/[\\/]/g, "·").trim() || "알 수 없는 오류";
  return `⚠️ AIMM 거울 생성 실패: ${safe}`;
}

/** stdin JSON에서 source 추출. 부재/파싱실패 시 "unknown". */
export function parseSessionSource(raw: string): string {
  try {
    const v = JSON.parse(raw) as { source?: unknown };
    return typeof v.source === "string" ? v.source : "unknown";
  } catch {
    return "unknown";
  }
}

/** 거울을 낼 source인가 — startup·resume만(나머지 스킵). */
export function shouldMirror(source: string): boolean {
  return source === "startup" || source === "resume";
}

/** hook 출력 JSON — systemMessage는 top-level(스파이크 정정). */
export function toHookOutput(systemMessage: string): string {
  return JSON.stringify({ systemMessage });
}
