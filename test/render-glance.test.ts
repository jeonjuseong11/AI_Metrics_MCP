import { describe, it, expect } from "vitest";
import { renderGlance } from "../src/core/render.js";
import type { UsageAnalysis } from "../src/core/analysis.js";
import type { ContentSummary } from "../src/core/content.js";

function mkAnalysis(over: Partial<UsageAnalysis>): UsageAnalysis {
  return {
    range: { start: "", end: "" },
    totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 },
    byModel: [], byDay: [], byHourKst: new Array(24).fill(0), byProject: [],
    busiestDay: undefined, hasUnknownModel: false, pricingVersion: "test",
    ...over,
  };
}

function csWithAreas(areas: Array<{ area: string; count: number }>): ContentSummary {
  return { sessionsWithContent: 3, userPrompts: 10, totalToolUses: 100, activity: [], areas, commands: [] };
}

describe("renderGlance", () => {
  it("어제 영역축 share% + 이번주 + 가장 바쁜 요일", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 3, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 1.4, durationMs: 0 },
      contentSummary: csWithAreas([
        { area: "TypeScript", count: 60 },
        { area: "문서", count: 25 },
        { area: "설정", count: 15 },
      ]),
    });
    const week = mkAnalysis({
      totals: { sessions: 12, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 8.7, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week, weekBusiestWeekday: "화" });
    expect(line).toContain("🪞 어제: 3세션 · $1.40");
    // 영역축 상위 2개 share%(count/합).
    expect(line).toContain("TypeScript 60%·문서 25%");
    // 상위 2개만 — 3번째(설정 15%) 제외.
    expect(line).not.toContain("설정 15%");
    expect(line).toContain("이번주(최근7일): 12세션 · $8.70");
    expect(line).toContain("가장 바쁜 요일 화");
    expect(line).not.toMatch(/[\\/]/); // 경로 누출 없음
  });

  it("영역 합 0(빈 areas) → 접미 생략(NaN 가드)", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
      contentSummary: csWithAreas([]),
    });
    const week = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week });
    expect(line).toBe("🪞 어제: 2세션 · $0.50  |  이번주(최근7일): 2세션 · $0.50");
  });

  it("content 없는 날 → 접미 생략", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const week = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week });
    expect(line).toContain("🪞 어제: 2세션 · $0.50");
    expect(line).not.toContain("%");
  });

  it("어제 없음 but 이번주 데이터", () => {
    const empty = mkAnalysis({});
    const week = mkAnalysis({
      totals: { sessions: 5, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 2.0, durationMs: 0 },
    });
    expect(renderGlance({ yesterday: empty, week })).toBe("🪞 어제 기록 없음 · 이번주(최근7일) 5세션 · $2.00");
  });

  it("cold start — 전부 빈", () => {
    const empty = mkAnalysis({});
    expect(renderGlance({ yesterday: empty, week: empty })).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });
});
