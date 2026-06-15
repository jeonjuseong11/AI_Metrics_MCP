import { describe, expect, it } from "vitest";
import { renderPortrait } from "../src/core/portrait.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const byHour = new Array<number>(24).fill(0);
  byHour[21] = 2; byHour[22] = 4; byHour[23] = 3; // 밤 21~23 피크
  return {
    range: { start: "2026-05-11", end: "2026-06-15" },
    totals: { sessions: 23, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 3434.04, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 3434.04, tokenShare: 1, costShare: 1 }],
    byDay: [
      { date: "2026-05-17", sessions: 1, displayTokens: 100, costUsd: 758.02 },
      { date: "2026-06-10", sessions: 5, displayTokens: 280, costUsd: 608.32 },
    ],
    byHourKst: byHour,
    byProject: [
      { project: "C--Users-jeonj-GitHub-turbo-pra", sessions: 5, displayTokens: 100, costUsd: 1204.27 },
      { project: "C--Users-jeonj-GitHub-AI-Metrics-MCP", sessions: 3, displayTokens: 50, costUsd: 700 },
    ],
    busiestDay: { date: "2026-05-17", sessions: 1, displayTokens: 100, costUsd: 758.02 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("renderPortrait", () => {
  it("5필드 헤더를 모두 포함한다", () => {
    const out = renderPortrait(fixture());
    for (const h of ["## 도구별 사용", "## 비용 요약", "## 발견", "## 시간대 패턴", "## 본인 메모"]) {
      expect(out).toContain(h);
    }
  });

  it("발견에 사용 패턴(케이던스)이 등장한다", () => {
    const out = renderPortrait(fixture());
    expect(out).toContain("평균 세션");
    expect(out).toContain("활동일");
  });

  it("막대/스파크라인 문자를 쓰지 않는다", () => {
    expect(renderPortrait(fixture())).not.toContain("█");
  });

  it("프로젝트명을 노출하지 않고 개수만 보여준다", () => {
    const out = renderPortrait(fixture());
    expect(out).not.toContain("turbo-pra");
    expect(out).not.toContain("AI-Metrics-MCP");
    expect(out).toContain("2개에 걸쳐");
  });

  it("정직성 푸터를 포함한다", () => {
    expect(renderPortrait(fixture())).toContain("*서술*이며 *평가*");
  });

  it("천단위 콤마 비용 포맷", () => {
    expect(renderPortrait(fixture())).toContain("$3,434.04");
  });

  it("시간대 최빈 구간을 '밤 21~23시'로 표기", () => {
    expect(renderPortrait(fixture())).toContain("밤 21~23시");
  });

  it("author/generatedDate를 헤더에 반영", () => {
    const out = renderPortrait(fixture(), { author: "전주성", generatedDate: "2026-06-15" });
    expect(out).toContain("# AI Craft 초상 — 전주성");
    expect(out).toContain("· 생성 2026-06-15");
  });

  it("세션 0이면 빈 초상(필드 표 생략)", () => {
    const out = renderPortrait(fixture({ totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } }));
    expect(out).toContain("기록된 AI 세션이 없습니다");
    expect(out).not.toContain("## 도구별 사용");
  });
});
