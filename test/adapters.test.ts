import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../src/adapters/claudeCode.js";
import * as discover from "../src/fs/discover.js";
import { buildAnalysis, buildStandup } from "../src/core/standup.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import type { NormalizedSession, ParseResult } from "../src/types.js";

// 정상 assistant 라인(opus, 토큰 input100/output50) 1개 = 메시지 1.
const GOOD =
  '{"timestamp":"2026-06-12T05:00:00.000Z","sessionId":"a","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}';
const CORRUPT = "{ this is not valid json";

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "aimm-adapters-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  vi.restoreAllMocks();
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("claudeCodeAdapter 계약 값", () => {
  it("id/displayName", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
    expect(claudeCodeAdapter.displayName).toBe("Claude Code");
  });
});

describe("claudeCodeAdapter.collect", () => {
  it("paths: 명시 파일을 읽고 손상은 warning으로 격리(throw 없음)", async () => {
    const dir = await makeTmp();
    const f1 = join(dir, "good.jsonl");
    const f2 = join(dir, "bad.jsonl");
    await writeFile(f1, GOOD + "\n");
    await writeFile(f2, CORRUPT + "\n");
    const r = await claudeCodeAdapter.collect({ paths: [f1, f2] });
    expect(r.sessions).toHaveLength(2); // 파일당 세션 1개(손상 파일은 메시지 0)
    const msgs = r.sessions.reduce((n, s) => n + s.messages.length, 0);
    expect(msgs).toBe(1); // good=1, bad=0
    expect(r.warnings.length).toBeGreaterThan(0); // 손상 라인 경고
  });

  it("rootDir: 자동 발견으로 projectsDir 하위 세션을 파싱(+ 발견 호출 1회로 spy 가로채기 검증)", async () => {
    const root = await makeTmp();
    const proj = join(root, "my-project");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "sess.jsonl"), GOOD + "\n");
    const spy = vi.spyOn(discover, "discoverSessionFiles");
    const r = await claudeCodeAdapter.collect({ rootDir: root });
    // spy가 어댑터의 named import 호출을 실제로 가로챈다는 증거(아래 not.toHaveBeenCalled 단언의 전제).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.messages).toHaveLength(1);
  });

  it("paths가 rootDir 자동발견을 대체(rootDir에 세션이 있어도 paths만 읽음)", async () => {
    const root = await makeTmp();
    const proj = join(root, "p");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "discovered.jsonl"), GOOD + "\n"); // 메시지 1
    const explicit = join(root, "explicit.jsonl");
    await writeFile(explicit, GOOD + "\n" + GOOD + "\n"); // 메시지 2
    const spy = vi.spyOn(discover, "discoverSessionFiles");
    const r = await claudeCodeAdapter.collect({ rootDir: root, paths: [explicit] });
    expect(spy).not.toHaveBeenCalled(); // paths가 주어지면 발견 자체를 안 함
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.messages).toHaveLength(2); // explicit(2), discovered(1) 아님
  });

  it("빈 paths([])는 자동 발견을 건너뛴다(rootDir에 세션이 있어도 0) — load-bearing 불변식", async () => {
    const root = await makeTmp();
    const proj = join(root, "p");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "s.jsonl"), GOOD + "\n"); // 발견되면 1개
    const spy = vi.spyOn(discover, "discoverSessionFiles");
    const r = await claudeCodeAdapter.collect({ paths: [], rootDir: root });
    expect(spy).not.toHaveBeenCalled(); // 빈 배열이 디스크 스캔으로 새지 않음(가드를 .length로 바꾸면 깨짐)
    expect(r).toEqual({ sessions: [], warnings: [] });
  });

  it("없는 디렉터리는 빈 결과(throw 없음)", async () => {
    const missing = join(tmpdir(), "aimm-nope-" + process.pid + "-x");
    const r = await claudeCodeAdapter.collect({ rootDir: missing });
    expect(r).toEqual({ sessions: [], warnings: [] });
  });
});

/** 2026-06-12 KST에 귀속되는 고유 토큰(합 10) 세션 1개. 실 Claude Code 경로가 낼 수 없는 값. */
function injectedSessions(): NormalizedSession[] {
  return [
    {
      sessionId: "INJECTED-UNIQUE",
      projectPath: "fake-proj",
      messages: [
        {
          model: "claude-opus-4-8",
          timestamp: new Date("2026-06-12T05:00:00.000Z"),
          tokens: { input: 7, output: 3, cacheRead: 0, cacheCreation: 0 },
        },
      ],
      startTime: new Date("2026-06-12T05:00:00.000Z"),
      endTime: new Date("2026-06-12T05:00:00.000Z"),
    },
  ];
}

describe("오케스트레이터 DI seam (E3 핵심)", () => {
  it("buildAnalysis가 주입 어댑터에만 의존 — 디스크 발견 호출 없이 분석 산출", async () => {
    const sessions = injectedSessions();
    const collect = vi.fn(async (): Promise<ParseResult> => ({ sessions, warnings: [] }));
    const fake: SourceAdapter = { id: "fake", displayName: "Fake", providesCost: true, collect };
    const discoverSpy = vi.spyOn(discover, "discoverSessionFiles");

    // sessionFiles/projectsDir 미지정 → 구버전이면 실 ~/.claude를 스캔했을 경로.
    const r = await buildAnalysis({ adapters: [fake] });

    expect(collect).toHaveBeenCalledTimes(1);
    expect(discoverSpy).not.toHaveBeenCalled(); // 오케스트레이터가 실 발견 경로를 전혀 안 탐
    expect(r.analysis.totals.sessions).toBe(1);
    const t = r.analysis.totals.tokens;
    expect(t.input + t.output + t.cacheRead + t.cacheCreation).toBe(10); // 주입 데이터가 흐름
  });

  it("buildStandup도 주입 어댑터 1회 호출 + 주입 데이터가 초안에 흐른다", async () => {
    const sessions = injectedSessions();
    const collect = vi.fn(async (): Promise<ParseResult> => ({ sessions, warnings: [] }));
    const fake: SourceAdapter = { id: "fake", displayName: "Fake", providesCost: true, collect };
    const discoverSpy = vi.spyOn(discover, "discoverSessionFiles");

    const r = await buildStandup({ adapters: [fake], date: "2026-06-12" });

    expect(collect).toHaveBeenCalledTimes(1);
    expect(discoverSpy).not.toHaveBeenCalled();
    // 주입 세션이 메트릭으로 렌더됨(단순 호출이 아니라 데이터 소비 증명).
    expect(r.draft).toContain("Opus");
  });
});

describe("기본 어댑터 배선", () => {
  it("adapter 미지정 시 기본이 정확히 claudeCodeAdapter (collect spy로 identity 고정)", async () => {
    const spy = vi.spyOn(claudeCodeAdapter, "collect");
    const r = await buildAnalysis({ sessionFiles: ["test/fixtures/one-session.jsonl"] });
    expect(spy).toHaveBeenCalledTimes(1); // 주입 없을 때 기본 어댑터가 호출됨
    expect(r.analysis.totals.sessions).toBe(1); // end-to-end로 픽스처 1세션 읽음
  });
});
