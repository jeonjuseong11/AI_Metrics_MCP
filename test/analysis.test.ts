import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analysis.js";
import type { NormalizedSession, TokenTotals } from "../src/types.js";

function tk(p: Partial<TokenTotals>): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...p };
}

function sess(opts: { id: string; project?: string; startIso: string; model: string; tokens: TokenTotals; endIso?: string }): NormalizedSession {
  const start = new Date(opts.startIso);
  return {
    sessionId: opts.id,
    projectPath: opts.project,
    messages: [{ model: opts.model, timestamp: start, tokens: opts.tokens }],
    startTime: start,
    endTime: new Date(opts.endIso ?? opts.startIso),
  };
}

describe("analyze", () => {
  it("빈 세션은 0 요약 + 빈 range", () => {
    const a = analyze([]);
    expect(a.totals.sessions).toBe(0);
    expect(a.byDay).toHaveLength(0);
    expect(a.busiestDay).toBeUndefined();
  });

  it("모델 비중(토큰/비용)이 합쳐서 100%", () => {
    const a = analyze([
      sess({ id: "1", startIso: "2026-06-08T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 1_000_000 }) }),
      sess({ id: "2", startIso: "2026-06-08T02:00:00Z", model: "claude-sonnet-4-6", tokens: tk({ input: 1_000_000 }) }),
    ]);
    const tokenSum = a.byModel.reduce((s, m) => s + m.tokenShare, 0);
    const costSum = a.byModel.reduce((s, m) => s + m.costShare, 0);
    expect(tokenSum).toBeCloseTo(1, 6);
    expect(costSum).toBeCloseTo(1, 6);
  });

  it("KST 날짜별로 그룹하고 range를 유도한다", () => {
    const a = analyze([
      sess({ id: "1", startIso: "2026-06-08T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 10 }) }), // KST 06-08
      sess({ id: "2", startIso: "2026-06-08T16:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 10 }) }), // KST 06-09 (UTC 16 +9)
    ]);
    expect(a.byDay.map((d) => d.date)).toEqual(["2026-06-08", "2026-06-09"]);
    expect(a.range).toEqual({ start: "2026-06-08", end: "2026-06-09" });
  });

  it("프로젝트별로 묶고 비용 내림차순 정렬", () => {
    const a = analyze([
      sess({ id: "1", project: "GitHub-cheap", startIso: "2026-06-08T01:00:00Z", model: "claude-haiku-4-5", tokens: tk({ input: 1000 }) }),
      sess({ id: "2", project: "GitHub-expensive", startIso: "2026-06-08T02:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 1_000_000 }) }),
    ]);
    expect(a.byProject[0]!.project).toBe("GitHub-expensive");
  });

  it("시간대 분포는 세션 시작 KST 시각을 센다", () => {
    // UTC 01:00 → KST 10시.
    const a = analyze([sess({ id: "1", startIso: "2026-06-08T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 10 }) })]);
    expect(a.byHourKst[10]).toBe(1);
    expect(a.byHourKst.reduce((s, c) => s + c, 0)).toBe(1);
  });

  it("가장 활발한 날은 비용 최대일", () => {
    const a = analyze([
      sess({ id: "1", startIso: "2026-06-08T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 1_000_000 }) }),
      sess({ id: "2", startIso: "2026-06-09T01:00:00Z", model: "claude-haiku-4-5", tokens: tk({ input: 1000 }) }),
    ]);
    expect(a.busiestDay?.date).toBe("2026-06-08");
  });

  it("start/end로 범위를 자른다", () => {
    const a = analyze(
      [
        sess({ id: "1", startIso: "2026-06-01T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 10 }) }),
        sess({ id: "2", startIso: "2026-06-08T01:00:00Z", model: "claude-opus-4-8", tokens: tk({ input: 10 }) }),
      ],
      { start: "2026-06-05", end: "2026-06-10" },
    );
    expect(a.totals.sessions).toBe(1);
    expect(a.byDay.map((d) => d.date)).toEqual(["2026-06-08"]);
  });
});
