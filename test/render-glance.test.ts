import { describe, it, expect } from "vitest";
import { renderGlance } from "../src/core/render.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function mkAnalysis(over: Partial<UsageAnalysis>): UsageAnalysis {
  return {
    range: { start: "", end: "" },
    totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 },
    byModel: [], byDay: [], byHourKst: new Array(24).fill(0), byProject: [],
    busiestDay: undefined, hasUnknownModel: false, pricingVersion: "test",
    ...over,
  };
}

describe("renderGlance", () => {
  it("renders yesterday + week with activity mix and busiest weekday", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 3, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 1.4, durationMs: 0 },
      contentSummary: {
        sessionsWithContent: 3, userPrompts: 10, totalToolUses: 100,
        activity: [
          { category: "탐색", count: 42, share: 0.42 },
          { category: "구현", count: 19, share: 0.19 },
          { category: "실행·검증", count: 15, share: 0.15 },
          { category: "계획·조율", count: 10, share: 0.10 },
        ],
        areas: [], commands: [],
      },
    });
    const week = mkAnalysis({
      totals: { sessions: 12, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 8.7, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week, weekBusiestWeekday: "화" });
    expect(line).toContain("🪞 어제: 3세션 · $1.40");
    expect(line).toContain("탐색42%·구현19%·실행·검증15%");
    expect(line).toContain("이번주(최근7일): 12세션 · $8.70");
    expect(line).toContain("가장 바쁜 요일 화");
    // 활동믹스는 상위 3개만
    expect(line).not.toContain("계획·조율10%");
    // 프라이버시: 경로 구분자 없음
    expect(line).not.toMatch(/[\\/]/);
  });

  it("yesterday empty but week has data", () => {
    const empty = mkAnalysis({});
    const week = mkAnalysis({
      totals: { sessions: 5, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 2.0, durationMs: 0 },
    });
    const line = renderGlance({ yesterday: empty, week });
    expect(line).toBe("🪞 어제 기록 없음 · 이번주(최근7일) 5세션 · $2.00");
  });

  it("cold start — everything empty", () => {
    const empty = mkAnalysis({});
    expect(renderGlance({ yesterday: empty, week: empty })).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });

  it("yesterday with sessions but no content summary omits activity mix", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const week = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week });
    expect(line).toContain("🪞 어제: 2세션 · $0.50");
    expect(line).toContain("이번주(최근7일): 2세션 · $0.50");
  });
});
