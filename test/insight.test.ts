import { describe, expect, it } from "vitest";
import { deriveInsights } from "../src/core/insight.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  return {
    range: { start: "2026-06-01", end: "2026-06-15" },
    totals: { sessions: 5, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 100, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 100, tokenShare: 1, costShare: 1 }],
    byDay: [
      { date: "2026-06-10", sessions: 2, displayTokens: 100, costUsd: 70 },
      { date: "2026-06-11", sessions: 3, displayTokens: 280, costUsd: 30 },
    ],
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions: 5, displayTokens: 380, costUsd: 100 }],
    busiestDay: { date: "2026-06-10", sessions: 2, displayTokens: 100, costUsd: 70 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("deriveInsights", () => {
  it("세션 0이면 빈 배열", () => {
    const empty = fixture({ totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } });
    expect(deriveInsights(empty)).toEqual([]);
  });

  it("비용이 하루에 20% 이상 집중되면 cost-concentration", () => {
    const cc = deriveInsights(fixture()).find((i) => i.kind === "cost-concentration");
    expect(cc?.text).toContain("70%");
    expect(cc?.text).toContain("2026-06-10");
  });

  it("집중이 20% 미만이면 cost-concentration 없음", () => {
    const ins = deriveInsights(fixture({ busiestDay: { date: "2026-06-10", sessions: 1, displayTokens: 10, costUsd: 10 } }));
    expect(ins.find((i) => i.kind === "cost-concentration")).toBeUndefined();
  });

  it("단일 모델이면 model-focus에 '단일 모델 집중'", () => {
    const mf = deriveInsights(fixture()).find((i) => i.kind === "model-focus");
    expect(mf?.text).toContain("100%");
    expect(mf?.text).toContain("Opus");
    expect(mf?.text).toContain("단일 모델 집중");
  });

  it("세션>0이면 최소 1개 보장", () => {
    expect(deriveInsights(fixture()).length).toBeGreaterThanOrEqual(1);
  });
});
