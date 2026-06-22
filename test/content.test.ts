import { describe, expect, it } from "vitest";
import { summarizeContent, isKnownExt, isKnownVerb, OTHER } from "../src/core/content.js";
import type { SessionContentDigest } from "../src/types.js";

function digest(p: Partial<SessionContentDigest>): SessionContentDigest {
  return { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {}, ...p };
}

describe("isKnownExt / isKnownVerb (닫힌 어휘 판정)", () => {
  it("알려진 확장자/동사만 true", () => {
    expect(isKnownExt(".ts")).toBe(true);
    expect(isKnownExt(".local")).toBe(false);
    expect(isKnownVerb("git")).toBe(true);
    expect(isKnownVerb("./deploy.sh")).toBe(false);
  });
});

describe("summarizeContent", () => {
  it("도구를 활동 카테고리로 합산하고 share를 계산한다", () => {
    const cs = summarizeContent([digest({ toolUses: { Edit: 6, Write: 4, Read: 5, Bash: 5 } })]);
    expect(cs.totalToolUses).toBe(20);
    const impl = cs.activity.find((a) => a.category === "구현")!;
    expect(impl.count).toBe(10);
    expect(impl.share).toBeCloseTo(0.5, 5);
    expect(cs.activity.find((a) => a.category === "탐색")!.count).toBe(5);
    expect(cs.activity.find((a) => a.category === "실행·검증")!.count).toBe(5);
  });

  it("확장자를 영역으로, 미지 확장자는 기타로 합산한다", () => {
    const cs = summarizeContent([digest({ fileExts: { ".ts": 10, ".tsx": 3, ".md": 4, [OTHER]: 2 } })]);
    expect(cs.areas.find((a) => a.area === "TypeScript")!.count).toBe(13);
    expect(cs.areas.find((a) => a.area === "문서")!.count).toBe(4);
    expect(cs.areas.find((a) => a.area === OTHER)!.count).toBe(2);
  });

  it("허용목록 동사를 명령 카테고리로, exampleVerbs는 허용목록만·기타는 예시 없음", () => {
    const cs = summarizeContent([digest({ commandVerbs: { git: 5, npm: 3, npx: 2, [OTHER]: 7 } })]);
    const pkg = cs.commands.find((c) => c.category === "패키지")!;
    expect(pkg.count).toBe(5);
    expect(pkg.exampleVerbs).toEqual(["npm", "npx"]); // count desc, tie code-unit
    const other = cs.commands.find((c) => c.category === OTHER)!;
    expect(other.count).toBe(7);
    expect(other.exampleVerbs).toEqual([]);
  });

  it("userPrompts·sessionsWithContent를 합산한다", () => {
    const cs = summarizeContent([digest({ userPrompts: 10 }), digest({ userPrompts: 5, toolUses: { Edit: 1 } })]);
    expect(cs.userPrompts).toBe(15);
    expect(cs.sessionsWithContent).toBe(2);
  });

  it("빈 입력은 0·빈 배열", () => {
    const cs = summarizeContent([]);
    expect(cs.sessionsWithContent).toBe(0);
    expect(cs.totalToolUses).toBe(0);
    expect(cs.activity).toEqual([]);
  });

  it("정렬은 count 내림차순, 동률은 코드유닛(결정적)", () => {
    const cs = summarizeContent([digest({ toolUses: { Read: 3, Edit: 3 } })]); // 탐색3·구현3 동률
    expect(cs.activity.map((a) => a.category)).toEqual(["구현", "탐색"]); // 구현<탐색 코드유닛
  });
});
