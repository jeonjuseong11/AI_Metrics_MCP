/**
 * 커밋 × AI 세션 시간 상관 (feature 4) — **비용 귀속 아님, 시간 상관만**.
 *
 * 정직성(척추): 한 세션이 여러 커밋·몇 시간에 걸쳐 있어 특정 커밋에 비용을 귀속하는 건
 * 거짓 정밀도다(프로젝트가 v0.9.0에서 의도적으로 안 함). 대신 *서술*로 안전한 것만:
 * "이 커밋 즈음 AI 세션이 있었나"라는 **시간 겹침**. 상관일 뿐 인과("이 세션이 이 커밋을
 * 만들었다")가 아니다.
 *
 * 판정: 커밋 시각이 어떤 세션 [start, end](± pad) 안에 들면 "AI 세션과 겹침".
 */

import type { Commit } from "../parse/git.js";
import type { NormalizedSession } from "../types.js";

export interface CommitCorrelation {
  totalCommits: number;
  /** 세션 시간창과 겹친 커밋 수. */
  withSession: number;
  /** withSession / totalCommits (0~1). */
  share: number;
  /** 판정에 쓴 여유(ms). */
  padMs: number;
}

const DEFAULT_PAD_MS = 30 * 60 * 1000; // ±30분

/** 커밋 시각이 세션 시간창(±pad) 안에 드는 비율. 순수·결정적. */
export function correlateCommits(
  commits: Commit[],
  sessions: NormalizedSession[],
  padMs: number = DEFAULT_PAD_MS,
): CommitCorrelation {
  const windows: Array<[number, number]> = [];
  for (const s of sessions) {
    if (s.startTime && s.endTime) {
      windows.push([s.startTime.getTime() - padMs, s.endTime.getTime() + padMs]);
    }
  }
  let withSession = 0;
  for (const c of commits) {
    const t = c.timestamp.getTime();
    if (windows.some(([a, b]) => t >= a && t <= b)) withSession++;
  }
  return {
    totalCommits: commits.length,
    withSession,
    share: commits.length > 0 ? withSession / commits.length : 0,
    padMs,
  };
}
