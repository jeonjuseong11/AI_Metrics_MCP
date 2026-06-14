import { describe, expect, it, vi } from "vitest";

// 이 파일은 마스킹 fail-closed 경계 전용이다. mask.js를 throw하도록 모킹해
// "마스킹이 실패하면 한 바이트도 전송되지 않는다"(이 기능의 최상위 보안 불변식)를 검증한다.
// vi.mock은 파일 전역에 적용되므로 실제 마스킹이 필요한 테스트와 섞이지 않게 별도 파일로 격리한다.
vi.mock("../src/core/mask.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/mask.js")>();
  return {
    ...actual,
    maskSecrets: () => {
      throw new actual.MaskerError("forced-test", new Error("forced mask failure"));
    },
  };
});

import { prepareNarrativeSend, narrateUsage } from "../src/core/narrative.js";
import { buildAnalysis } from "../src/core/standup.js";
import type { Summarizer } from "../src/llm/summarizer.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function fixture(): UsageAnalysis {
  const byHour = new Array<number>(24).fill(0);
  byHour[15] = 1;
  return {
    range: { start: "2026-06-08", end: "2026-06-14" },
    totals: { sessions: 3, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 1, durationMs: 1000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 1, tokenShare: 1, costShare: 1 }],
    byDay: [{ date: "2026-06-12", sessions: 3, displayTokens: 380, costUsd: 1 }],
    byHourKst: byHour,
    byProject: [{ project: "C--Users-jeonj-GitHub-X", sessions: 3, displayTokens: 380, costUsd: 1 }],
    busiestDay: { date: "2026-06-12", sessions: 3, displayTokens: 380, costUsd: 1 },
    hasUnknownModel: false,
    pricingVersion: "test",
  };
}

const FIX = ["test/fixtures/one-session.jsonl"];

describe("narrative fail-closed (마스킹이 throw하면 전송 차단)", () => {
  it("prepareNarrativeSend는 마스커가 던지면 그대로 전파한다(부분 결과 없음)", () => {
    expect(() => prepareNarrativeSend(fixture())).toThrow();
  });

  it("narrateUsage는 마스킹 실패 시 내레이터를 호출하지 않는다", async () => {
    let called = false;
    const spy: Summarizer = async () => {
      called = true;
      return "x";
    };
    await expect(narrateUsage(fixture(), spy)).rejects.toThrow();
    expect(called).toBe(false); // 마스킹이 내레이터보다 먼저 — 실패하면 전송 0
  });

  it("buildAnalysis(send)는 마스킹 차단 시 내레이터 미호출 + 결정적 폴백 + warning", async () => {
    let called = false;
    const spy: Summarizer = async () => {
      called = true;
      return "x";
    };
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, summarizer: spy });
    expect(called).toBe(false);
    expect(r.narrative).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("LLM 서술 실패"))).toBe(true);
  });

  it("buildAnalysis(dry-run)도 마스킹 차단 시 preview 없이 warning을 남긴다", async () => {
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, dryRunLlm: true });
    expect(r.preview).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("마스킹 차단"))).toBe(true);
  });
});
