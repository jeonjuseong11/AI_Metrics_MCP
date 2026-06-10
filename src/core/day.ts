/**
 * 일자 귀속 — KST(UTC+9) day boundary (§4.4).
 *
 * JSONL/Git 타임스탬프는 UTC다. 표시·집계는 KST 기준으로 한다. KST는 DST 없음.
 * 세션은 "세션 시작 시각 기준" 하루로 귀속한다. 자정을 넘는 세션도 시작 시각의
 * KST 날짜에 속한다.
 */

import type { Commit } from "../parse/git.js";
import type { NormalizedSession } from "../types.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC 인스턴트가 속한 KST 날짜("YYYY-MM-DD"). */
export function toKstDateString(utc: Date): string {
  const kst = new Date(utc.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
}

/** "YYYY-MM-DD"(KST 날짜)를 UTC 구간 [start, end)로. */
export function kstDayRange(kstDate: string): { startUtc: Date; endUtc: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(kstDate);
  if (!m) throw new Error(`invalid KST date: ${kstDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // KST 자정 = 그 UTC 인스턴트에서 9시간을 뺀 시각.
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - KST_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

/** now 기준 KST '어제' 날짜 문자열. */
export function yesterdayKst(now: Date): string {
  return toKstDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

function inRange(t: Date, start: Date, end: Date): boolean {
  const ms = t.getTime();
  return ms >= start.getTime() && ms < end.getTime();
}

/** 커밋을 author date의 KST 날짜로 필터. */
export function commitsOnKstDay(commits: Commit[], kstDate: string): Commit[] {
  const { startUtc, endUtc } = kstDayRange(kstDate);
  return commits.filter((c) => inRange(c.timestamp, startUtc, endUtc));
}

/** 세션을 시작 시각의 KST 날짜로 귀속(자정 넘는 세션은 시작일 기준). */
export function sessionsOnKstDay(sessions: NormalizedSession[], kstDate: string): NormalizedSession[] {
  const { startUtc, endUtc } = kstDayRange(kstDate);
  return sessions.filter((s) => s.startTime !== undefined && inRange(s.startTime, startUtc, endUtc));
}
