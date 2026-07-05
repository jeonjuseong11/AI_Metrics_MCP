import { describe, it, expect } from "vitest";
import { renderContentBlock } from "../src/core/render.js";
import type { ContentSummary } from "../src/core/content.js";

function mkCs(over: Partial<ContentSummary> = {}): ContentSummary {
  return {
    sessionsWithContent: 3,
    userPrompts: 12,
    totalToolUses: 100,
    activity: [
      { category: "구현", count: 50, share: 0.5 },
      { category: "탐색", count: 30, share: 0.3 },
    ],
    areas: [
      { area: "TypeScript", count: 40 },
      { area: "문서", count: 10 },
    ],
    commands: [
      { category: "버전관리", count: 8, exampleVerbs: ["git", "gh"] },
      { category: "패키지", count: 4, exampleVerbs: ["npm"] },
    ],
    ...over,
  };
}

describe("renderContentBlock", () => {
  it("3축 + 대화 깊이 + 캐비엇을 본문 줄로 반환, 헤딩은 제외", () => {
    const lines = renderContentBlock(mkCs());
    const joined = lines.join("\n");
    expect(joined).toContain("- 활동: 구현 50% · 탐색 30%");
    expect(joined).toContain("- 다룬 영역: TypeScript 40 · 문서 10");
    expect(joined).toContain("- 명령: 버전관리(git·gh 8) · 패키지(npm 4)");
    expect(joined).toContain("- 대화 깊이: 사용자 요청 ~12건");
    expect(joined).toContain("ℹ️ tool_use 빈도 기반 휴리스틱");
    expect(joined).toContain("서브에이전트 내부 작업은 제외");
    // 헤딩은 호출부가 붙인다 — 블록에 없어야.
    expect(joined).not.toContain("## 무엇을 했나");
  });

  it("sessionsWithContent==0 → 빈 배열(이중 안전)", () => {
    expect(renderContentBlock(mkCs({ sessionsWithContent: 0 }))).toEqual([]);
  });

  it("빈 축은 해당 줄 생략(활동만 있을 때)", () => {
    const lines = renderContentBlock(mkCs({ areas: [], commands: [] }));
    const joined = lines.join("\n");
    expect(joined).toContain("- 활동:");
    expect(joined).not.toContain("- 다룬 영역:");
    expect(joined).not.toContain("- 명령:");
  });
});
