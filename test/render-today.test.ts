import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToday } from "../src/core/render.js";
import { runToday } from "../src/core/sessionStart.js";
import type { UsageAnalysis } from "../src/core/analysis.js";
import type { ContentSummary } from "../src/core/content.js";

function mk(sessions: number, costUsd: number, cs?: ContentSummary): UsageAnalysis {
  return {
    range: { start: "", end: "" },
    totals: { sessions, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd, durationMs: 0 },
    byModel: [], byDay: [], byHourKst: new Array(24).fill(0), byProject: [],
    busiestDay: undefined, hasUnknownModel: false, pricingVersion: "test",
    ...(cs ? { contentSummary: cs } : {}),
  };
}

const cs: ContentSummary = {
  sessionsWithContent: 2, userPrompts: 8, totalToolUses: 50,
  activity: [{ category: "구현", count: 30, share: 0.6 }],
  areas: [{ area: "TypeScript", count: 20 }],
  commands: [],
};

describe("renderToday — 3-window 빈상태 매트릭스", () => {
  it("today>0 · yesterday>0 · week>0 → 오늘 3축 · 어제 줄 · 이번주 줄", () => {
    const out = renderToday(mk(2, 3.0, cs), mk(3, 1.2), mk(15, 37.8));
    expect(out).toContain("🪞 오늘(지금까지): 2세션 · $3.00");
    expect(out).toContain("- 활동: 구현 60%");
    expect(out).toContain("어제: 3세션 · $1.20");
    expect(out).toContain("이번주(최근7일): 15세션 · $37.80");
  });

  it("today==0 · yesterday>0 (오전) → 오늘 없음 · 어제 줄", () => {
    const out = renderToday(mk(0, 0), mk(3, 1.2), mk(15, 37.8));
    expect(out).toContain("🪞 오늘 아직 기록 없음");
    expect(out).toContain("어제: 3세션 · $1.20");
    expect(out).not.toContain("- 활동:");
  });

  it("today>0 · yesterday==0 → 오늘 3축 · 어제 없음", () => {
    const out = renderToday(mk(2, 3.0, cs), mk(0, 0), mk(15, 37.8));
    expect(out).toContain("🪞 오늘(지금까지): 2세션");
    expect(out).toContain("어제: 기록 없음");
  });

  it("today==0 · yesterday==0 · week>0 → 둘 다 없음 · 이번주 요약", () => {
    const out = renderToday(mk(0, 0), mk(0, 0), mk(5, 2.0));
    expect(out).toContain("🪞 오늘 아직 기록 없음");
    expect(out).toContain("어제: 기록 없음");
    expect(out).toContain("이번주(최근7일): 5세션 · $2.00");
  });

  it("전부 0 → cold-start 한 줄", () => {
    expect(renderToday(mk(0, 0), mk(0, 0), mk(0, 0))).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });
});

// 어제(KST)·오늘(KST) startTime을 가진 assistant 세션 1줄.
function assistantLine(isoTs: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: isoTs,
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}

describe("runToday — parse-once 통합(now 주입)", () => {
  let dir: string;
  const now = new Date("2026-06-28T05:00:00Z"); // KST 14:00 → 오늘=2026-06-28, 어제=2026-06-27
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aimm-today-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("오늘+어제 세션 → 오늘·어제·이번주 모두 반영", async () => {
    const t = join(dir, "today.jsonl");
    const y = join(dir, "yesterday.jsonl");
    writeFileSync(t, assistantLine("2026-06-28T02:00:00Z")); // KST 11:00 오늘
    writeFileSync(y, assistantLine("2026-06-27T02:00:00Z")); // KST 11:00 어제
    const out = await runToday({ now, sessionFiles: [t, y] });
    expect(out).toContain("🪞 오늘(지금까지): 1세션");
    expect(out).toContain("어제: 1세션");
    expect(out).toContain("이번주(최근7일): 2세션"); // 오늘 포함
    expect(out).not.toMatch(/[\\/]/); // 경로 누출 없음(닫힌 어휘만)
  });

  it("세션 없음 → cold-start", async () => {
    const out = await runToday({ now, sessionFiles: [] });
    expect(out).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });
});
