import { describe, expect, it } from "vitest";
import { buildSummaryContext, prepareSend, summarizeAccomplishments } from "../src/core/summarize.js";
import { SummarizerError, type Summarizer } from "../src/llm/summarizer.js";
import { MaskerError } from "../src/core/mask.js";
import type { Commit } from "../src/parse/git.js";

function commit(short: string, subject: string): Commit {
  return { hash: short + "x", shortHash: short, author: "전주성", timestamp: new Date("2026-06-09T01:00:00Z"), subject };
}

const echo: Summarizer = async (ctx) => `요약: ${ctx.split("\n").length}개 항목`;

describe("summarize", () => {
  it("buildSummaryContext는 커밋을 해시+제목으로 나열한다", () => {
    const ctx = buildSummaryContext([commit("a3f9c21", "parse: fix"), commit("7b1e004", "fix: merge")]);
    expect(ctx).toContain("a3f9c21 parse: fix");
    expect(ctx).toContain("7b1e004 fix: merge");
  });

  it("prepareSend는 커밋 메시지 속 비밀을 마스킹한다", () => {
    const { maskedContext, redactions } = prepareSend([commit("h1", "chore: rotate AKIAIOSFODNN7EXAMPLE")]);
    expect(maskedContext).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactions.length).toBe(1);
  });

  it("summarizeAccomplishments는 요약기 산문을 반환한다", async () => {
    const r = await summarizeAccomplishments([commit("a", "do X"), commit("b", "do Y")], echo);
    expect(r.prose).toContain("2개 항목");
  });

  it("커밋이 없으면 SummarizerError(empty)를 던진다", async () => {
    await expect(summarizeAccomplishments([], echo)).rejects.toBeInstanceOf(SummarizerError);
  });

  it("요약기가 빈 응답이면 SummarizerError(empty)를 던진다", async () => {
    const empty: Summarizer = async () => "   ";
    await expect(summarizeAccomplishments([commit("a", "x")], empty)).rejects.toMatchObject({ kind: "empty" });
  });

  it("요약기 에러는 그대로 전파된다(호출부가 폴백)", async () => {
    const boom: Summarizer = async () => {
      throw new SummarizerError("transport", "네트워크 실패");
    };
    await expect(summarizeAccomplishments([commit("a", "x")], boom)).rejects.toMatchObject({ kind: "transport" });
  });

  it("fail-closed: 마스커가 던지면 전송 준비도 던진다(전송 차단)", () => {
    const huge = commit("a", "x".repeat(5_000_001));
    expect(() => prepareSend([huge])).toThrow(MaskerError);
  });
});
