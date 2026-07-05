import { describe, expect, it } from "vitest";
import { classifyCommitType, summarizeSituation, labelCommitType } from "../src/core/situation.js";
import type { Commit } from "../src/parse/git.js";

function commit(subject: string): Commit {
  return { hash: "h" + subject, shortHash: "h", author: "u", timestamp: new Date("2026-06-12T05:00:00Z"), subject };
}

describe("classifyCommitType", () => {
  it("conventional 접두사를 타입으로 분류한다", () => {
    expect(classifyCommitType("feat: x")).toBe("feat");
    expect(classifyCommitType("fix(api): y")).toBe("fix");
    expect(classifyCommitType("refactor!: z")).toBe("refactor");
    expect(classifyCommitType("DOCS: caps")).toBe("docs");
    expect(classifyCommitType("  chore: 선행공백")).toBe("chore");
  });

  it("접두사 없음/미지의 단어는 기타", () => {
    expect(classifyCommitType("WIP something")).toBe("기타");
    expect(classifyCommitType("Merge branch 'main'")).toBe("기타");
    expect(classifyCommitType("wip: 미지 타입")).toBe("기타");
  });
});

describe("summarizeSituation", () => {
  it("타입별 count·share를 내림차순으로 집계한다(동률은 타입 알파벳)", () => {
    const s = summarizeSituation([
      commit("feat: a"),
      commit("fix: b"),
      commit("fix: c"),
      commit("fix: d"),
      commit("docs: e"),
    ]);
    expect(s.total).toBe(5);
    expect(s.byType[0]).toMatchObject({ type: "fix", count: 3 });
    expect(s.byType[0].share).toBeCloseTo(0.6);
    expect(s.byType.map((t) => t.type)).toEqual(["fix", "docs", "feat"]);
  });

  it("빈 입력은 total 0", () => {
    const s = summarizeSituation([]);
    expect(s.total).toBe(0);
    expect(s.byType).toEqual([]);
  });

  it("기타와 일반 타입이 동률이면 로케일과 무관하게 결정적으로 정렬한다", () => {
    // feat 2, 기타 2 → count 동률 → 코드유닛 비교로 "feat" < "기타"(비ASCII)
    const s = summarizeSituation([commit("feat: a"), commit("feat: b"), commit("WIP x"), commit("Merge y")]);
    expect(s.byType.map((t) => t.type)).toEqual(["feat", "기타"]);
  });
});

describe("summarizeSituation — 무엇을 만들었나(built)", () => {
  it("feat/fix/refactor/perf 제목만 뽑고 docs/chore/기타는 제외", () => {
    const s = summarizeSituation([
      commit("feat: 거울"),
      commit("docs: 노트"),
      commit("refactor: seam"),
      commit("chore: 잡무"),
      commit("fix: 버그"),
      commit("WIP 미지"),
      commit("perf: 속도"),
    ]);
    expect(s.built.map((b) => b.subject)).toEqual(["feat: 거울", "refactor: seam", "fix: 버그", "perf: 속도"]);
    expect(s.built.map((b) => b.type)).toEqual(["feat", "refactor", "fix", "perf"]);
    expect(s.builtTotal).toBe(4);
  });

  it("입력(git log) 순서를 유지한다(최신 우선)", () => {
    const s = summarizeSituation([commit("feat: 나중"), commit("fix: 중간"), commit("feat: 처음")]);
    expect(s.built.map((b) => b.subject)).toEqual(["feat: 나중", "fix: 중간", "feat: 처음"]);
  });

  it("MAX_BUILT(8) 초과 시 built는 상한, builtTotal은 전체", () => {
    const commits = Array.from({ length: 11 }, (_, i) => commit(`feat: f${i}`));
    const s = summarizeSituation(commits);
    expect(s.built.length).toBe(8);
    expect(s.builtTotal).toBe(11);
  });

  it("built 없는 커밋(docs만)은 빈 배열", () => {
    const s = summarizeSituation([commit("docs: a"), commit("chore: b")]);
    expect(s.built).toEqual([]);
    expect(s.builtTotal).toBe(0);
  });
});

describe("labelCommitType", () => {
  it("알려진 타입에 한글 글로스를 붙인다", () => {
    expect(labelCommitType("fix")).toBe("fix(수정/디버깅)");
    expect(labelCommitType("기타")).toBe("기타");
  });
});
