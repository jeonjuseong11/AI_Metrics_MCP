import { describe, expect, it } from "vitest";
import { deriveFindings } from "../src/core/findings.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

type Day = { date: string; sessions: number; displayTokens: number; costUsd: number };

function fixture(byDay: Day[]): UsageAnalysis {
  const sessions = byDay.reduce((s, d) => s + d.sessions, 0);
  const dates = byDay.map((d) => d.date).sort();
  const busiest = [...byDay].sort((a, b) => b.costUsd - a.costUsd)[0];
  return {
    range: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
    totals: { sessions, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, costUsd: byDay.reduce((s, d) => s + d.costUsd, 0), durationMs: sessions * 3600000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 4, costUsd: 1, tokenShare: 1, costShare: 1 }],
    byDay,
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions, displayTokens: 4, costUsd: 1 }],
    busiestDay: busiest,
    hasUnknownModel: false,
    pricingVersion: "test",
  };
}

function d(date: string, sessions: number, costUsd: number): Day {
  return { date, sessions, displayTokens: 4, costUsd };
}

describe("deriveFindings", () => {
  it("cost-spike가 있으면 cost-concentration을 뺀다", () => {
    const ins = deriveFindings(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)]));
    expect(ins.some((i) => i.kind === "cost-spike")).toBe(true);
    expect(ins.some((i) => i.kind === "cost-concentration")).toBe(false);
  });

  it("최대 5개로 자른다", () => {
    expect(deriveFindings(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)])).length).toBeLessThanOrEqual(5);
  });

  it("패턴이 E1 인사이트보다 앞에 온다", () => {
    const ins = deriveFindings(fixture([d("2026-06-10", 2, 10)]));
    expect(ins[0]?.kind).toBe("session-cadence");
  });
});
