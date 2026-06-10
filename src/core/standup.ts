/**
 * 스크럼 초안 오케스트레이터 — CLI/hook/MCP가 공유하는 코어 함수(부록 A A3).
 *
 *   세션 발견·수집 ─┐
 *                   ├─ KST 일자 필터 ─ 메트릭 집계 ─┐
 *   git 수집 ───────┘                                ├─ 렌더 ─ 초안
 *                     (커밋 KST 일자 필터) ──────────┘
 *
 * LLM 요약은 아직 미연동(다음 슬라이스). 현재는 원시 커밋 목록 + 결정적 메트릭으로
 * 초안을 만든다 = §4.4의 LLM-실패 폴백과 동일한 안전 경로.
 */

import { aggregate } from "./metrics.js";
import { commitsOnKstDay, kstDayRange, sessionsOnKstDay, yesterdayKst } from "./day.js";
import { renderDraft } from "./render.js";
import { collectCommits } from "../fs/git.js";
import { discoverSessionFiles } from "../fs/discover.js";
import { readSessionFiles } from "../fs/sessions.js";
import type { Commit } from "../parse/git.js";
import type { ParseWarning } from "../types.js";

export interface StandupOptions {
  /** KST 날짜 "YYYY-MM-DD". 없으면 now 기준 어제. */
  date?: string;
  author?: string;
  /** git 커밋을 수집할 저장소 경로. 없으면 커밋 생략. */
  repoPath?: string;
  /** 명시 세션 파일. 없으면 projectsDir에서 발견. */
  sessionFiles?: string[];
  projectsDir?: string;
  /** 테스트용 고정 시각. */
  now?: Date;
}

export interface StandupResult {
  date: string;
  draft: string;
  warnings: string[];
}

export async function buildStandup(opts: StandupOptions = {}): Promise<StandupResult> {
  const now = opts.now ?? new Date();
  const date = opts.date ?? yesterdayKst(now);
  const warnings: string[] = [];

  // 1. 세션 수집 → KST 일자 필터 → 메트릭.
  const files = opts.sessionFiles ?? (await discoverSessionFiles(opts.projectsDir));
  const parsed = await readSessionFiles(files);
  for (const w of parsed.warnings) warnings.push(formatParseWarning(w));
  const daySessions = sessionsOnKstDay(parsed.sessions, date);
  const metrics = aggregate(daySessions);

  // 2. git 커밋 수집(선택) → KST 일자 필터(이중 안전).
  let commits: Commit[] = [];
  if (opts.repoPath) {
    const { startUtc, endUtc } = kstDayRange(date);
    const r = await collectCommits(opts.repoPath, startUtc, endUtc, opts.author);
    if (r.warning) warnings.push(r.warning);
    commits = commitsOnKstDay(r.commits, date);
  }

  // 3. 렌더.
  const draftOpts: Parameters<typeof renderDraft>[2] = opts.author
    ? { date, author: opts.author }
    : { date };
  const draft = renderDraft(commits, metrics, draftOpts);
  return { date, draft, warnings };
}

function formatParseWarning(w: ParseWarning): string {
  return w.line > 0 ? `parse line ${w.line}: ${w.reason}` : w.reason;
}
