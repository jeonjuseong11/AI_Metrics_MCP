import { describe, expect, it } from "vitest";
import { renderDraft, renderMetricsBlock } from "../src/core/render.js";
import { aggregate } from "../src/core/metrics.js";
import type { Commit } from "../src/parse/git.js";
import type { NormalizedSession, TokenTotals } from "../src/types.js";

function tk(p: Partial<TokenTotals>): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...p };
}

const sampleCommits: Commit[] = [
  { hash: "a3f9c21x", shortHash: "a3f9c21", author: "전주성", timestamp: new Date("2026-06-09T01:00:00Z"), subject: "parse: handle multiline tool_result" },
];

const sampleSession: NormalizedSession = {
  sessionId: "s1",
  projectPath: undefined,
  messages: [{ model: "claude-opus-4-8", timestamp: new Date("2026-06-09T01:00:00Z"), tokens: tk({ input: 38000, output: 1000 }) }],
  startTime: new Date("2026-06-09T01:00:00Z"),
  endTime: new Date("2026-06-09T03:42:00Z"),
};

describe("renderDraft", () => {
  it("빈 날(커밋0+세션0)은 '기록된 활동 없음'을 낸다", () => {
    const draft = renderDraft([], aggregate([]), { date: "2026-06-09" });
    expect(draft).toContain("오늘 기록된 활동 없음");
    expect(draft).not.toContain("## 어제 한 일");
  });

  it("커밋을 해시 근거와 함께 '어제 한 일'에 렌더한다", () => {
    const draft = renderDraft(sampleCommits, aggregate([sampleSession]), { date: "2026-06-09", author: "전주성" });
    expect(draft).toContain("# 일일 스크럼 — 2026-06-09 (전주성)");
    expect(draft).toContain("## 어제 한 일");
    expect(draft).toContain("`a3f9c21`");
    expect(draft).toContain("## AI 사용 메트릭");
  });

  it("generationFailed면 폴백 에러 노트를 포함한다", () => {
    const draft = renderDraft(sampleCommits, aggregate([sampleSession]), { date: "2026-06-09", generationFailed: true });
    expect(draft).toContain("초안 생성(LLM 요약) 실패");
  });

  it("커밋만 없고 세션은 있으면 그 사실을 명시한다", () => {
    const draft = renderDraft([], aggregate([sampleSession]), { date: "2026-06-09" });
    expect(draft).toContain("커밋 기록 없음");
    expect(draft).toContain("## AI 사용 메트릭");
  });
});

describe("renderMetricsBlock", () => {
  it("세션 없으면 '기록된 AI 세션 없음'", () => {
    expect(renderMetricsBlock(aggregate([]))).toContain("기록된 AI 세션 없음");
  });

  it("정산액 아님 단서를 항상 붙인다", () => {
    expect(renderMetricsBlock(aggregate([sampleSession]))).toContain("정산액 아님");
  });
});
