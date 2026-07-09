import { describe, expect, it } from "vitest";
import { renderDraft, renderMetricsBlock, renderAnalysis } from "../src/core/render.js";
import { aggregate } from "../src/core/metrics.js";
import type { Commit } from "../src/parse/git.js";
import type { NormalizedSession, TokenTotals } from "../src/types.js";
import type { UsageAnalysis } from "../src/core/analysis.js";
import type { SituationSummary } from "../src/core/situation.js";
import { OTHER } from "../src/core/content.js";

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

  it("LLM 산문이 있으면 커밋 목록 대신 산문 + 근거 해시를 렌더한다", () => {
    const draft = renderDraft(sampleCommits, aggregate([sampleSession]), {
      date: "2026-06-09",
      accomplishments: "- 멀티라인 tool_result 파싱을 추가했다",
    });
    expect(draft).toContain("멀티라인 tool_result 파싱을 추가했다");
    expect(draft).toContain("근거 커밋: `a3f9c21`");
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

function analysisFixture(): UsageAnalysis {
  return {
    range: { start: "2026-06-08", end: "2026-06-14" },
    totals: { sessions: 5, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 1.0, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 1.0, tokenShare: 1, costShare: 1 }],
    byDay: [{ date: "2026-06-12", sessions: 5, displayTokens: 380, costUsd: 1.0 }],
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "C--Users-jeonj-GitHub-X", sessions: 5, displayTokens: 380, costUsd: 1.0 }],
    busiestDay: { date: "2026-06-12", sessions: 5, displayTokens: 380, costUsd: 1.0 },
    hasUnknownModel: false,
    pricingVersion: "test",
  };
}

describe("renderAnalysis 산문 섹션", () => {
  it("narrative를 주면 '한 주 돌아보기' 섹션을 맨 위에 넣는다", () => {
    const out = renderAnalysis(analysisFixture(), undefined, "오후에 집중해 Opus를 주로 썼다.");
    expect(out).toContain("## 한 주 돌아보기");
    expect(out).toContain("오후에 집중해 Opus를 주로 썼다.");
    // 산문 섹션이 요약 섹션보다 앞에 온다.
    expect(out.indexOf("## 한 주 돌아보기")).toBeLessThan(out.indexOf("## 요약"));
  });

  it("narrative가 없으면 산문 섹션을 넣지 않는다", () => {
    const out = renderAnalysis(analysisFixture());
    expect(out).not.toContain("## 한 주 돌아보기");
  });

  it("heading을 주면 제목을 바꾼다(retro='AI 회고'), 기본은 'AI 사용 분석'", () => {
    expect(renderAnalysis(analysisFixture())).toContain("# AI 사용 분석");
    expect(renderAnalysis(analysisFixture(), undefined, undefined, undefined, "AI 회고")).toContain("# AI 회고");
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

describe("renderAnalysis 작업 성격 섹션", () => {
  it("situation을 주면 '작업 성격' 섹션 + 정직성 라벨을 넣는다", () => {
    const out = renderAnalysis(analysisFixture(), undefined, undefined, sampleSituation);
    expect(out).toContain("## 작업 성격 (커밋 타입)");
    expect(out).toContain("fix(수정/디버깅)");
    expect(out).toContain("시간 추정이지 커밋별 증명이 아닙니다");
  });

  it("situation이 없으면 '작업 성격' 섹션이 없다", () => {
    expect(renderAnalysis(analysisFixture())).not.toContain("## 작업 성격");
  });
});

describe("renderAnalysis 무엇을 만들었나 섹션", () => {
  it("built 커밋 제목 + 이 기간 비용을 넣는다", () => {
    const out = renderAnalysis(analysisFixture(), undefined, undefined, sampleSituation);
    expect(out).toContain("## 무엇을 만들었나 (이 기간 추정 $");
    expect(out).toContain("- feat: 거울 내용화");
    expect(out).toContain("- fix: 폴백 보강");
    expect(out).toContain("… 외 3건"); // builtTotal 5 - built 2
    expect(out).toContain("git 커밋 제목 기반");
    // 만든 것 섹션이 작업 성격(타입 분포)보다 앞에 온다.
    expect(out.indexOf("## 무엇을 만들었나")).toBeLessThan(out.indexOf("## 작업 성격"));
  });

  it("built가 없으면 '무엇을 만들었나' 섹션이 없다", () => {
    const noBuilt: SituationSummary = { total: 2, byType: [{ type: "docs", count: 2, share: 1 }], built: [], builtTotal: 0 };
    expect(renderAnalysis(analysisFixture(), undefined, undefined, noBuilt)).not.toContain("## 무엇을 만들었나");
  });
});

describe("renderAnalysis 무엇을 했나 섹션", () => {
  function withContent(): UsageAnalysis {
    const a = analysisFixture();
    a.contentSummary = {
      sessionsWithContent: 8,
      userPrompts: 278,
      totalToolUses: 1800,
      activity: [
        { category: "구현", count: 880, share: 880 / 1800 },
        { category: "탐색", count: 500, share: 500 / 1800 },
        { category: "실행·검증", count: 420, share: 420 / 1800 },
      ],
      areas: [
        { area: "TypeScript", count: 508 },
        { area: "문서", count: 240 },
      ],
      commands: [
        { category: "패키지", count: 83, exampleVerbs: ["npm", "pnpm", "npx"] },
        { category: OTHER, count: 12, exampleVerbs: [] },
      ],
    };
    return a;
  }

  it("contentSummary가 있으면 '무엇을 했나' 섹션을 넣는다", () => {
    const out = renderAnalysis(withContent());
    expect(out).toContain("## 무엇을 했나 (세션 내용 기반)");
    expect(out).toContain("구현 49%");
    expect(out).toContain("TypeScript 508");
    expect(out).toContain("패키지(npm·pnpm·npx 83)");
    expect(out).toContain("기타 12"); // 기타는 카운트만, 예시 없음
    expect(out).toContain("사용자 요청 ~278건");
    expect(out).toContain("서브에이전트 내부 작업은 제외");
  });

  it("내용 섹션에 경로 구분자(/ \\)가 없다(프라이버시)", () => {
    const out = renderAnalysis(withContent());
    const section = out.slice(out.indexOf("## 무엇을 했나"));
    expect(section).not.toMatch(/[/\\]/);
  });

  it("contentSummary가 없으면 섹션이 없다", () => {
    expect(renderAnalysis(analysisFixture())).not.toContain("## 무엇을 했나");
  });
});
