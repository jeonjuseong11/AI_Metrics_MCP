/**
 * 커밋 타입 분류 — 상황 신호(Phase 1 ②)의 결정적 데이터 계층.
 *
 * conventional-commit 접두사(feat/fix/refactor…)로 "이 기간 어떤 성격의 작업을
 * 했나"를 분류한다. 순수·결정적. *서술*이지 *평가*가 아니다(휴리스틱).
 */

import type { Commit } from "../parse/git.js";

const KNOWN_TYPES = new Set([
  "feat", "fix", "refactor", "docs", "test", "chore", "style", "perf", "build", "ci", "revert",
]);

const GLOSS: Record<string, string> = {
  feat: "신규", fix: "수정/디버깅", refactor: "리팩터", docs: "문서", test: "테스트",
  chore: "잡무", style: "스타일", perf: "성능", build: "빌드", ci: "CI", revert: "되돌림",
};

/** conventional-commit 접두사에서 타입을 뽑는다. 미지정/미지의 단어는 '기타'. */
export function classifyCommitType(subject: string): string {
  const m = /^\s*(\w+)(?:\([^)]*\))?!?:/.exec(subject);
  if (!m || m[1] === undefined) return "기타";
  const type = m[1].toLowerCase();
  return KNOWN_TYPES.has(type) ? type : "기타";
}

/** 표시용 한글 글로스를 붙인다(예: fix → "fix(수정/디버깅)"). 글로스 없으면 타입 그대로. */
export function labelCommitType(type: string): string {
  const g = GLOSS[type];
  return g ? `${type}(${g})` : type;
}

export interface SituationSummary {
  byType: Array<{ type: string; count: number; share: number }>;
  total: number;
}

/** 커밋들을 타입별로 집계(count 내림차순, 동률은 타입 알파벳). 순수·결정적. */
export function summarizeSituation(commits: Commit[]): SituationSummary {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const t = classifyCommitType(c.subject);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = commits.length;
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, count, share: total > 0 ? count / total : 0 }))
    // 동률은 코드유닛 비교로 정렬 — localeCompare는 호스트 로케일 의존이라 비결정적.
    .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return { byType, total };
}
