import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAnalysis, buildStandup } from "../src/core/standup.js";
import { claudeCodeAdapter } from "../src/adapters/claudeCode.js";
import { cursorAdapter } from "../src/adapters/cursor.js";
import { renderAnalysis } from "../src/core/render.js";
import { renderPortrait } from "../src/core/portrait.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import type { NormalizedSession, ParseResult } from "../src/types.js";

function ccSession(): NormalizedSession {
  return {
    sessionId: "cc1",
    projectPath: "proj",
    messages: [
      { model: "claude-opus-4-8", timestamp: new Date("2026-06-12T05:00:00.000Z"), tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 } },
    ],
    startTime: new Date("2026-06-12T05:00:00.000Z"),
    endTime: new Date("2026-06-12T05:00:00.000Z"),
  };
}
function cursorSession(): NormalizedSession {
  return {
    sessionId: "cur1",
    projectPath: undefined,
    messages: [
      { model: "unknown", timestamp: new Date("2026-06-12T06:00:00.000Z"), tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
    ],
    startTime: new Date("2026-06-12T06:00:00.000Z"),
    endTime: new Date("2026-06-12T06:00:00.000Z"),
  };
}
function fakeAdapter(id: string, displayName: string, providesCost: boolean, sessions: NormalizedSession[]): SourceAdapter {
  return { id, displayName, providesCost, collect: async (): Promise<ParseResult> => ({ sessions, warnings: [] }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("멀티소스 결정성/오염 방지", () => {
  it("sessionFiles 주입(adapters 미지정) → 코어 기본 claude-only, cursor.collect 미호출", async () => {
    const ccSpy = vi.spyOn(claudeCodeAdapter, "collect");
    const cursorSpy = vi.spyOn(cursorAdapter, "collect").mockResolvedValue({ sessions: [], warnings: [] });
    const r = await buildAnalysis({ sessionFiles: ["test/fixtures/one-session.jsonl"] });
    expect(cursorSpy).not.toHaveBeenCalled(); // 멀티소스 default가 테스트를 오염시키지 않음
    expect(ccSpy).toHaveBeenCalledTimes(1); // positive control
    expect(r.analysis.byTool?.map((t) => t.source)).toEqual(["claude-code"]);
  });
});

describe("멀티소스 집계 + cost-unknown 격리(blocker 회귀)", () => {
  it("Cursor(unknown 모델·0토큰)가 hasUnknownModel/모델믹스/단가미상을 오염시키지 않음", async () => {
    const cc = fakeAdapter("claude-code", "Claude Code", true, [ccSession()]);
    const cur = fakeAdapter("cursor", "Cursor", false, [cursorSession()]);
    const { analysis } = await buildAnalysis({ adapters: [cc, cur] });

    const tools = analysis.byTool ?? [];
    expect(tools).toHaveLength(2);
    expect(tools.find((t) => t.source === "cursor")?.costKnown).toBe(false);
    expect(tools.find((t) => t.source === "claude-code")?.costKnown).toBe(true);

    // 오염 차단: cost-unknown 소스가 모델/단가 집계에 안 들어감
    expect(analysis.hasUnknownModel).toBe(false);
    expect(analysis.byModel.some((m) => m.model === "unknown")).toBe(false);

    // 6차원 전부 격리: totals/byProject/byHourKst/byDay도 cost-known(cc 1개)만 반영.
    expect(analysis.totals.sessions).toBe(1);
    expect(analysis.byProject.some((p) => p.project === "(unknown)")).toBe(false); // cursor projectPath=undefined 유령 행 없음
    expect(analysis.byHourKst.reduce((s, c) => s + c, 0)).toBe(1);
    expect(analysis.byDay.reduce((s, d) => s + d.sessions, 0)).toBe(1);

    const doc = renderAnalysis(analysis);
    expect(doc).not.toContain("단가 미상");
  });

  it("portrait 도구별 표에 Cursor 미상 행 + 캐비엇", async () => {
    const cc = fakeAdapter("claude-code", "Claude Code", true, [ccSession()]);
    const cur = fakeAdapter("cursor", "Cursor", false, [cursorSession()]);
    const { analysis } = await buildAnalysis({ adapters: [cc, cur] });
    const out = renderPortrait(analysis);
    expect(out).toContain("| Cursor |");
    expect(out).toContain("미상");
    expect(out).toContain("세션 정의는 도구마다");
    expect(out).not.toContain("E3/E5");
  });

  it("Cursor 단독(cost-known 0)도 '세션 없음' 거짓 대신 도구별 표를 보여준다", async () => {
    const cur = fakeAdapter("cursor", "Cursor", false, [cursorSession()]);
    const { analysis } = await buildAnalysis({ adapters: [cur] });
    expect(analysis.totals.sessions).toBe(0); // cost-known 0
    const portraitOut = renderPortrait(analysis);
    expect(portraitOut).not.toContain("기록된 AI 세션이 없습니다");
    expect(portraitOut).toContain("| Cursor |");
    const doc = renderAnalysis(analysis);
    expect(doc).not.toContain("기록된 AI 세션이 없습니다");
    expect(doc).toContain("Cursor");
  });
});

describe("standup 멀티소스 주입", () => {
  it("buildStandup({adapters:[cc,cursor]})가 두 소스 모두 1회 수집(throw 없음)", async () => {
    const ccCollect = vi.fn(async (): Promise<ParseResult> => ({ sessions: [ccSession()], warnings: [] }));
    const curCollect = vi.fn(async (): Promise<ParseResult> => ({ sessions: [cursorSession()], warnings: [] }));
    const cc: SourceAdapter = { id: "claude-code", displayName: "Claude Code", providesCost: true, collect: ccCollect };
    const cur: SourceAdapter = { id: "cursor", displayName: "Cursor", providesCost: false, collect: curCollect };
    const r = await buildStandup({ adapters: [cc, cur], date: "2026-06-12" });
    expect(ccCollect).toHaveBeenCalledTimes(1);
    expect(curCollect).toHaveBeenCalledTimes(1);
    expect(r.draft).toContain("일일 스크럼");
  });
});
