import { describe, expect, it } from "vitest";
import { derivePatterns } from "../src/core/patterns.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

type Day = { date: string; sessions: number; displayTokens: number; costUsd: number };

function fixture(byDay: Day[], over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const sessions = byDay.reduce((s, d) => s + d.sessions, 0);
  const dates = byDay.map((d) => d.date).sort();
  return {
    range: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
    totals: { sessions, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, costUsd: byDay.reduce((s, d) => s + d.costUsd, 0), durationMs: sessions * 3600000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 4, costUsd: 1, tokenShare: 1, costShare: 1 }],
    byDay,
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions, displayTokens: 4, costUsd: 1 }],
    busiestDay: byDay[0],
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

function d(date: string, sessions: number, costUsd: number): Day {
  return { date, sessions, displayTokens: 4, costUsd };
}

describe("derivePatterns", () => {
  it("세션 케이던스는 항상 나온다(평균 세션·활동일)", () => {
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 10)]));
    const c = ins.find((i) => i.kind === "session-cadence");
    expect(c?.text).toContain("평균 세션");
    expect(c?.text).toContain("활동");
  });

  it("활동일이 기간 대비 적으면 '몰아서'", () => {
    const ins = derivePatterns(fixture([d("2026-05-11", 1, 5), d("2026-06-15", 1, 5)]));
    expect(ins.find((i) => i.kind === "session-cadence")?.text).toContain("몰아서");
  });

  it("주말 비중 낮으면 '주로 평일' (활동일>=3)", () => {
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 5), d("2026-06-11", 2, 5), d("2026-06-12", 2, 5)]));
    expect(ins.find((i) => i.kind === "weekday-rhythm")?.text).toContain("주로 평일");
  });

  it("활동일 2개면 요일 리듬 생략", () => {
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 5), d("2026-06-11", 2, 5)]));
    expect(ins.find((i) => i.kind === "weekday-rhythm")).toBeUndefined();
  });

  it("후반부 세션이 많으면 '더 자주' (기간>=6)", () => {
    const ins = derivePatterns(fixture([d("2026-06-02", 1, 5), d("2026-06-09", 6, 5)]));
    expect(ins.find((i) => i.kind === "usage-trend")?.text).toContain("더 자주");
  });

  it("비용이 한 날만 크면 '튄 날' (활동일>=4)", () => {
    const ins = derivePatterns(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)]));
    const cs = ins.find((i) => i.kind === "cost-spike");
    expect(cs?.text).toContain("튄 날");
    expect(cs?.text).toContain("2026-06-04");
  });

  it("활동일 3개면 비용 급증 생략", () => {
    const ins = derivePatterns(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 100)]));
    expect(ins.find((i) => i.kind === "cost-spike")).toBeUndefined();
  });

  it("세션 0이면 빈 배열", () => {
    const empty = fixture([], { totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } });
    expect(derivePatterns(empty)).toEqual([]);
  });
});
