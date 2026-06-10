import { describe, expect, it } from "vitest";
import { aggregate } from "../src/core/metrics.js";
import type { NormalizedSession, TokenTotals } from "../src/types.js";

function tokens(p: Partial<TokenTotals>): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...p };
}

function session(id: string, msgs: { model: string; ts: string; tokens: TokenTotals }[]): NormalizedSession {
  const times = msgs.map((m) => new Date(m.ts).getTime());
  return {
    sessionId: id,
    projectPath: undefined,
    messages: msgs.map((m) => ({ model: m.model, timestamp: new Date(m.ts), tokens: m.tokens })),
    startTime: times.length ? new Date(Math.min(...times)) : undefined,
    endTime: times.length ? new Date(Math.max(...times)) : undefined,
  };
}

describe("aggregate", () => {
  it("같은 모델 메시지의 토큰을 합산한다", () => {
    const s = session("s1", [
      { model: "claude-opus-4-8", ts: "2026-06-02T10:00:00Z", tokens: tokens({ input: 100, output: 50 }) },
      { model: "claude-opus-4-8", ts: "2026-06-02T10:05:00Z", tokens: tokens({ input: 200, output: 25 }) },
    ]);
    const agg = aggregate([s]);
    expect(agg.byModel).toHaveLength(1);
    expect(agg.byModel[0]!.tokens).toEqual({ input: 300, output: 75, cacheRead: 0, cacheCreation: 0 });
    expect(agg.totals.input).toBe(300);
  });

  it("캐시 토큰을 별도 단가로 반영한다 (cache_read = input의 10%)", () => {
    // opus input 정가 $15/1M. input 1M → $15. cache_read 1M → $1.5.
    const s = session("s1", [
      { model: "claude-opus-4-8", ts: "2026-06-02T10:00:00Z", tokens: tokens({ input: 1_000_000, cacheRead: 1_000_000 }) },
    ]);
    const agg = aggregate([s]);
    expect(agg.totalCostUsd).toBeCloseTo(15 + 1.5, 6);
  });

  it("알 수 없는 모델은 비용 0 + unknownModel 플래그", () => {
    const s = session("s1", [
      { model: "gpt-4o", ts: "2026-06-02T10:00:00Z", tokens: tokens({ input: 1_000_000 }) },
    ]);
    const agg = aggregate([s]);
    expect(agg.hasUnknownModel).toBe(true);
    expect(agg.byModel[0]!.costUsd).toBe(0);
    expect(agg.totalCostUsd).toBe(0);
  });

  it("세션 지속시간은 wall-clock 합(start~end)이다", () => {
    const s = session("s1", [
      { model: "claude-sonnet-4-6", ts: "2026-06-02T10:00:00Z", tokens: tokens({ input: 1 }) },
      { model: "claude-sonnet-4-6", ts: "2026-06-02T12:30:00Z", tokens: tokens({ input: 1 }) },
    ]);
    const agg = aggregate([s]);
    expect(agg.totalDurationMs).toBe(2.5 * 60 * 60 * 1000);
  });

  it("빈 세션 목록은 0으로 채운 결과를 낸다", () => {
    const agg = aggregate([]);
    expect(agg.byModel).toHaveLength(0);
    expect(agg.totalCostUsd).toBe(0);
    expect(agg.sessionCount).toBe(0);
    expect(agg.totalDurationMs).toBe(0);
  });

  it("모델 순서는 결정적(사전순)이다", () => {
    const s = session("s1", [
      { model: "claude-sonnet-4-6", ts: "2026-06-02T10:00:00Z", tokens: tokens({ input: 1 }) },
      { model: "claude-haiku-4-5", ts: "2026-06-02T10:01:00Z", tokens: tokens({ input: 1 }) },
      { model: "claude-opus-4-8", ts: "2026-06-02T10:02:00Z", tokens: tokens({ input: 1 }) },
    ]);
    const agg = aggregate([s]);
    expect(agg.byModel.map((m) => m.model)).toEqual(["claude-haiku-4-5", "claude-opus-4-8", "claude-sonnet-4-6"]);
  });
});
