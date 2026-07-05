/**
 * SessionStart 거울 — stdin source 필터 + top-level systemMessage 출력.
 *
 * 스파이크 실측(CC v2.1.195): 사용자 표출은 **top-level `systemMessage`**.
 * `hookSpecificOutput.systemMessage`(nested)·`additionalContext`는 사용자 비표출.
 * 거울은 startup·resume에만(compact·clear 스킵 — 스팸 방지).
 */

import { collectSessions, type CollectCommon } from "./standup.js";
import { analyze } from "./analysis.js";
import { yesterdayKst, isoDatePlusDays, weekdayOf, WEEKDAY, toKstDateString, kstDayRange } from "./day.js";
import { renderGlance, renderToday } from "./render.js";
import { summarizeSituation } from "./situation.js";
import { collectCommits } from "../fs/git.js";
import type { UsageAnalysis } from "./analysis.js";

/** 거울/today 수집창 — 자동 발견 파일을 최근 N일 mtime로 좁혀 startup 비용을 상수화. 분석창(≤8일)+슬랙. */
const COLLECT_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

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

/** collectSessions 공통 옵션 구성 — 명시 sessionFiles 없으면 mtime 수집창 캡(startup 상수화). */
function windowCommon(now: Date, opts: SessionStartOptions): CollectCommon {
  const common: CollectCommon = {};
  if (opts.sessionFiles) common.sessionFiles = opts.sessionFiles;
  if (opts.projectsDir) common.projectsDir = opts.projectsDir;
  if (!opts.sessionFiles) common.sinceMtimeMs = now.getTime() - COLLECT_WINDOW_MS;
  return common;
}

/**
 * SessionStart 거울 한 줄. 코어 재사용(claude-only cost-known). 실패해도 throw 안 함.
 * parse-once: 세션을 1회 수집하고 analyze()를 어제·이번주 두 범위로 부른다(디스크 파싱 1회).
 */
export async function runSessionStart(opts: SessionStartOptions = {}): Promise<string> {
  try {
    const now = opts.now ?? new Date();
    const yDate = yesterdayKst(now);
    const weekStart = isoDatePlusDays(yDate, -6); // 최근 7일(어제 종료)

    const { sessions, sourceMeta } = await collectSessions(windowCommon(now, opts)); // claude-only(기본)
    const yesterday = analyze(sessions, { start: yDate, end: yDate }, sourceMeta);
    const week = analyze(sessions, { start: weekStart, end: yDate }, sourceMeta);

    const input: import("./render.js").GlanceInput = { yesterday, week };
    const wd = busiestWeekday(week);
    if (wd) input.weekBusiestWeekday = wd;
    return renderGlance(input);
  } catch (err) {
    return failureGlance(err);
  }
}

/**
 * `aimm today` 코어 — 오늘(지금까지) + 어제 + 이번주(오늘 포함) 풀뷰. claude-only.
 * parse-once: 세션을 1회 수집하고 analyze()를 세 범위(오늘·어제·이번주)로 부른다.
 */
export interface TodayOptions extends SessionStartOptions {
  /** 주어지면 이 repo의 오늘 커밋(feat/fix/refactor/perf 제목)을 "만든 것"으로 표시. */
  repoPath?: string;
  author?: string;
  /** 테스트·주입용 커밋 수집기. 미지정 시 실제 collectCommits. */
  commitCollector?: typeof collectCommits;
}

export async function runToday(opts: TodayOptions = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const tDate = toKstDateString(now);
  const yDate = yesterdayKst(now);
  const weekStart = isoDatePlusDays(tDate, -6); // 최근 7일 ending 오늘(오늘 포함)

  const { sessions, sourceMeta } = await collectSessions(windowCommon(now, opts)); // claude-only
  const today = analyze(sessions, { start: tDate, end: tDate }, sourceMeta);
  const yesterday = analyze(sessions, { start: yDate, end: yDate }, sourceMeta);
  const week = analyze(sessions, { start: weekStart, end: tDate }, sourceMeta);

  // --repo 시 오늘(KST) 커밋의 "만든 것"(feat/fix/refactor/perf 제목). git 실패는 무시(today는 계속).
  let built: Array<{ type: string; subject: string }> | undefined;
  if (opts.repoPath) {
    try {
      const { startUtc, endUtc } = kstDayRange(tDate);
      const collector = opts.commitCollector ?? collectCommits;
      const r = await collector(opts.repoPath, startUtc, endUtc, opts.author);
      const s = summarizeSituation(r.commits);
      if (s.built.length > 0) built = s.built;
    } catch {
      // git 수집 실패는 조용히 무시 — 사용 현황은 그대로 보여준다.
    }
  }
  return renderToday(today, yesterday, week, built);
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
