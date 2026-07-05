import { describe, expect, it } from "vitest";
import { buildNarrativeContext, prepareNarrativeSend, narrateUsage } from "../src/core/narrative.js";
import { buildAnalysis } from "../src/core/standup.js";
import { kstDayRange } from "../src/core/day.js";
import { SummarizerError, type Summarizer } from "../src/llm/summarizer.js";
import type { UsageAnalysis } from "../src/core/analysis.js";
import type { SituationSummary } from "../src/core/situation.js";
import { OTHER } from "../src/core/content.js";

/** 테스트용 최소 UsageAnalysis 픽스처. 필요한 필드만 채우고 나머지는 합리적 기본값. */
function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const byHour = new Array<number>(24).fill(0);
  byHour[15] = 5; // 오후 피크
  return {
    range: { start: "2026-06-08", end: "2026-06-14" },
    totals: {
      sessions: 23,
      tokens: { input: 1000, output: 500, cacheRead: 2000, cacheCreation: 300 },
      costUsd: 4.1,
      durationMs: 3_600_000,
    },
    byModel: [
      { model: "claude-opus-4-8", displayTokens: 6200, costUsd: 3.1, tokenShare: 0.62, costShare: 0.76 },
      { model: "claude-sonnet-4-6", displayTokens: 2800, costUsd: 0.8, tokenShare: 0.28, costShare: 0.2 },
      { model: "claude-haiku-4-5", displayTokens: 1000, costUsd: 0.2, tokenShare: 0.1, costShare: 0.04 },
    ],
    byDay: [
      { date: "2026-06-12", sessions: 8, displayTokens: 5000, costUsd: 1.4 },
      { date: "2026-06-13", sessions: 15, displayTokens: 5000, costUsd: 2.7 },
    ],
    byHourKst: byHour,
    byProject: [
      { project: "C--Users-jeonj-GitHub-AI_Metrics_MCP", sessions: 18, displayTokens: 7000, costUsd: 3.0 },
      { project: "C--Users-jeonj-GitHub-AIWS-Front", sessions: 5, displayTokens: 3000, costUsd: 1.1 },
    ],
    busiestDay: { date: "2026-06-12", sessions: 8, displayTokens: 5000, costUsd: 1.4 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("buildNarrativeContext", () => {
  it("기간·총계·모델믹스·시간대·프로젝트·가장활발을 라벨과 함께 낸다", () => {
    const ctx = buildNarrativeContext(fixture());
    expect(ctx).toContain("[기간] 2026-06-08 ~ 2026-06-14 (KST)");
    expect(ctx).toContain("세션 23");
    expect(ctx).toContain("Opus 62% 토큰");
    expect(ctx).toContain("오후");
    expect(ctx).toContain("[가장 활발] 2026-06-12");
  });

  it("프로젝트 슬러그를 읽기 쉬운 이름으로 줄인다", () => {
    const ctx = buildNarrativeContext(fixture());
    expect(ctx).toContain("AI_Metrics_MCP");
    expect(ctx).not.toContain("C--Users-jeonj");
  });

  it("0토큰 모델(<synthetic> 등)을 모델믹스에서 제외한다", () => {
    const ctx = buildNarrativeContext(
      fixture({
        byModel: [
          { model: "claude-opus-4-8", displayTokens: 1000, costUsd: 1, tokenShare: 1, costShare: 1 },
          { model: "<synthetic>", displayTokens: 0, costUsd: 0, tokenShare: 0, costShare: 0 },
        ],
      }),
    );
    expect(ctx).toContain("Opus");
    expect(ctx).not.toContain("synthetic");
  });

  it("0토큰 프로젝트를 빼고 상위 6개만 + 외 N개로 줄인다", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      project: `C--Users-jeonj-GitHub-P${i}`,
      sessions: 1,
      displayTokens: 100 * (8 - i), // 내림차순(P0이 가장 큼)
      costUsd: 1,
    }));
    many.push({ project: "C--Users-jeonj-GitHub-ZeroTok", sessions: 1, displayTokens: 0, costUsd: 0 });
    const ctx = buildNarrativeContext(fixture({ byProject: many }));
    expect(ctx).toContain("외 2개"); // 8개(0토큰 제외) 중 상위 6개 표시, 2개 생략
    expect(ctx).not.toContain("ZeroTok"); // 0토큰 제외
    // 정렬 방향까지 고정: 토큰 많은 P0은 표시, 가장 적은 P6·P7은 생략돼야 한다.
    expect(ctx).toContain("P0");
    expect(ctx).not.toContain("P6");
    expect(ctx).not.toContain("P7");
  });
});

const echo: Summarizer = async (ctx) => `서술: ${ctx.split("\n").length}줄`;

describe("prepareNarrativeSend", () => {
  it("사실 블록 속 비밀을 마스킹한다", () => {
    const a = fixture({
      byProject: [
        { project: "C--Users-jeonj-GitHub-AKIAIOSFODNN7EXAMPLE", sessions: 1, displayTokens: 100, costUsd: 0.1 },
      ],
    });
    const { maskedContext, redactions } = prepareNarrativeSend(a);
    expect(maskedContext).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactions.length).toBe(1);
  });
});

describe("narrateUsage", () => {
  it("내레이터 산문을 반환한다", async () => {
    const r = await narrateUsage(fixture(), echo);
    expect(r.prose).toContain("서술:");
  });

  it("세션 0건이면 SummarizerError(empty)를 던진다", async () => {
    const empty = fixture({
      totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 },
    });
    await expect(narrateUsage(empty, echo)).rejects.toMatchObject({ kind: "empty" });
  });

  it("내레이터 빈 응답이면 SummarizerError(empty)를 던진다", async () => {
    const blank: Summarizer = async () => "   ";
    await expect(narrateUsage(fixture(), blank)).rejects.toMatchObject({ kind: "empty" });
  });

  it("내레이터 에러는 그대로 전파된다(호출부가 폴백)", async () => {
    const boom: Summarizer = async () => {
      throw new SummarizerError("transport", "네트워크 실패");
    };
    await expect(narrateUsage(fixture(), boom)).rejects.toMatchObject({ kind: "transport" });
  });
});

const sampleSituation: SituationSummary = {
  total: 5,
  byType: [
    { type: "fix", count: 3, share: 0.6 },
    { type: "feat", count: 2, share: 0.4 },
  ],
  built: [
    { type: "feat", subject: "feat: 거울 내용화" },
    { type: "fix", subject: "fix: 폴백 보강" },
  ],
  builtTotal: 5,
};

describe("buildNarrativeContext 작업성격", () => {
  it("situation을 주면 [작업성격] 줄을 추가한다", () => {
    const ctx = buildNarrativeContext(fixture(), sampleSituation);
    expect(ctx).toContain("[작업성격]");
    expect(ctx).toContain("fix 60%");
    expect(ctx).toContain("커밋 5건");
  });

  it("built가 있으면 [만든것] 줄(커밋 제목)을 추가한다", () => {
    const ctx = buildNarrativeContext(fixture(), sampleSituation);
    expect(ctx).toContain("[만든것]");
    expect(ctx).toContain("feat: 거울 내용화");
    expect(ctx).toContain("외 3건"); // builtTotal 5 - built 2
  });

  it("situation이 없으면 [작업성격]·[만든것] 줄이 없다", () => {
    const ctx = buildNarrativeContext(fixture());
    expect(ctx).not.toContain("[작업성격]");
    expect(ctx).not.toContain("[만든것]");
  });
});

describe("buildNarrativeContext 작업내용", () => {
  function withContent() {
    return fixture({
      contentSummary: {
        sessionsWithContent: 8,
        userPrompts: 278,
        totalToolUses: 1000,
        activity: [
          { category: "구현", count: 490, share: 0.49 },
          { category: "탐색", count: 280, share: 0.28 },
          { category: "실행·검증", count: 230, share: 0.23 },
        ],
        areas: [
          { area: "TypeScript", count: 5 },
          { area: "Java", count: 3 },
        ],
        commands: [
          { category: "패키지", count: 5, exampleVerbs: ["npm"] },
          { category: OTHER, count: 2, exampleVerbs: [] },
        ],
      },
    });
  }

  it("content 있으면 [작업내용] 줄을 카테고리·정수로만 넣는다", () => {
    const ctx = buildNarrativeContext(withContent());
    expect(ctx).toContain("[작업내용]");
    expect(ctx).toContain("구현49%");
    expect(ctx).toContain("요청 278건");
    const line = ctx.split("\n").find((l) => l.startsWith("[작업내용]"))!;
    expect(line).not.toMatch(/[/\\]/); // 경로·원시토큰 없음
  });

  it("content 없으면 [작업내용] 줄이 없다", () => {
    expect(buildNarrativeContext(fixture())).not.toContain("[작업내용]");
  });
});

describe("buildAnalysis LLM 분기", () => {
  it("세션이 없으면 useLlm이어도 narrative/preview가 없다", async () => {
    const r = await buildAnalysis({ sessionFiles: [], useLlm: true, dryRunLlm: true });
    expect(r.analysis.totals.sessions).toBe(0);
    expect(r.narrative).toBeUndefined();
    expect(r.preview).toBeUndefined();
  });
});

describe("buildAnalysis 세션>0 경로", () => {
  const FIX = ["test/fixtures/one-session.jsonl"];

  it("드라이런이면 preview를 채우고 내레이터를 호출하지 않는다", async () => {
    let called = false;
    const spy: Summarizer = async () => {
      called = true;
      return "x";
    };
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, dryRunLlm: true, summarizer: spy });
    expect(r.analysis.totals.sessions).toBeGreaterThan(0);
    expect(r.preview?.maskedContext).toContain("[기간]");
    expect(r.narrative).toBeUndefined();
    expect(called).toBe(false); // 드라이런은 절대 전송하지 않는다(전송 경계)
  });

  it("내레이터 주입이면 narrative를 채운다", async () => {
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, summarizer: echo });
    expect(r.narrative).toContain("서술:");
  });

  it("send 경로에서 비밀이 가려지면 '마스킹' 경고를 남긴다", async () => {
    // 프로젝트 슬러그(부모 디렉터리명)에 가짜 AWS 키가 박힌 픽스처 → 사실 블록에 들어가 마스킹됨.
    const r = await buildAnalysis({
      sessionFiles: ["test/fixtures/AKIAIOSFODNN7EXAMPLE/sess.jsonl"],
      useLlm: true,
      summarizer: echo,
    });
    expect(r.narrative).toContain("서술:"); // 마스킹된 내용으로 전송은 진행
    expect(r.warnings.some((w) => w.includes("마스킹"))).toBe(true);
  });

  it("내레이터 실패면 결정적 문서로 폴백하고 warning을 남긴다", async () => {
    const boom: Summarizer = async () => {
      throw new SummarizerError("transport", "네트워크 실패");
    };
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, summarizer: boom });
    expect(r.narrative).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("LLM 서술 실패"))).toBe(true);
  });
});

describe("buildAnalysis 상황 신호(--repo)", () => {
  const FIX = ["test/fixtures/one-session.jsonl"];
  const fakeCommits = [
    { hash: "a", shortHash: "a", author: "u", timestamp: new Date("2026-06-12T05:00:00Z"), subject: "fix: bug" },
    { hash: "b", shortHash: "b", author: "u", timestamp: new Date("2026-06-12T06:00:00Z"), subject: "feat: x" },
  ];

  it("repoPath + commitCollector 주입 시 situation을 채우고 사실블록에 [작업성격]을 넣는다", async () => {
    const r = await buildAnalysis({
      sessionFiles: FIX,
      repoPath: "/x",
      commitCollector: async () => ({ commits: fakeCommits }),
      useLlm: true,
      dryRunLlm: true,
    });
    expect(r.situation?.total).toBe(2);
    expect(r.preview?.maskedContext).toContain("[작업성격]");
  });

  it("collector가 warning을 내면 situation 없이 warning + 결정적 문서 유지", async () => {
    const r = await buildAnalysis({
      sessionFiles: FIX,
      repoPath: "/x",
      commitCollector: async () => ({ commits: [], warning: "git 실패" }),
    });
    expect(r.situation).toBeUndefined();
    expect(r.warnings).toContain("git 실패");
  });

  it("collector가 throw해도 결정적 문서로 폴백 + '상황 신호 수집 실패' warning(불변식 4)", async () => {
    const r = await buildAnalysis({
      sessionFiles: FIX,
      repoPath: "/x",
      commitCollector: async () => {
        throw new Error("git boom");
      },
    });
    expect(r.situation).toBeUndefined();
    expect(r.analysis.totals.sessions).toBeGreaterThan(0); // 결정적 문서는 살아있다
    expect(r.warnings.some((w) => w.includes("상황 신호 수집 실패"))).toBe(true);
  });

  it("collector에 세션 분석 창(UTC)과 author를 그대로 넘긴다", async () => {
    let seen: [string, Date, Date, string | undefined] | undefined;
    const collector = async (repo: string, s: Date, e: Date, author?: string) => {
      seen = [repo, s, e, author];
      return { commits: fakeCommits };
    };
    await buildAnalysis({ sessionFiles: FIX, repoPath: "/x", author: "전주성", commitCollector: collector });
    expect(seen?.[0]).toBe("/x");
    // 창은 세션 분석 기간(2026-06-12)의 KST 일자 경계를 UTC로 변환한 값과 같아야 한다.
    expect(seen?.[1].toISOString()).toBe(kstDayRange("2026-06-12").startUtc.toISOString());
    expect(seen?.[2].toISOString()).toBe(kstDayRange("2026-06-12").endUtc.toISOString());
    expect(seen?.[3]).toBe("전주성");
  });

  it("--repo인데 세션이 0이면 작업 성격을 생략하고 사유를 알린다", async () => {
    let called = false;
    const r = await buildAnalysis({
      sessionFiles: [],
      repoPath: "/x",
      commitCollector: async () => {
        called = true;
        return { commits: fakeCommits };
      },
    });
    expect(called).toBe(false); // 세션 0이면 git 수집조차 안 함(낭비 방지)
    expect(r.situation).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("작업 성격을 생략"))).toBe(true);
  });
});
