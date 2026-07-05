import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessions } from "../src/core/standup.js";
import { claudeCodeAdapter } from "../src/adapters/claudeCode.js";
import { filterRecentByMtime } from "../src/fs/discover.js";
import type { SourceAdapter, CollectOptions } from "../src/adapters/types.js";
import type { NormalizedSession } from "../src/types.js";

function fakeSession(id: string): NormalizedSession {
  return { sessionId: id, projectPath: undefined, messages: [], startTime: undefined, endTime: undefined };
}

function fakeAdapter(
  id: string,
  opts: { providesCost?: boolean; sessions?: NormalizedSession[]; fail?: boolean; capture?: (o: CollectOptions) => void } = {},
): SourceAdapter {
  return {
    id,
    displayName: id.toUpperCase(),
    providesCost: opts.providesCost ?? true,
    async collect(o: CollectOptions = {}) {
      opts.capture?.(o);
      if (opts.fail) throw new Error("boom");
      return { sessions: opts.sessions ?? [fakeSession(`${id}-1`)], warnings: [] };
    },
  };
}

/** assistant 1줄 JSONL(비용 산출 가능). */
function assistantLine(isoTs: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: isoTs,
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}

describe("collectSessions", () => {
  it("소스 id를 세션에 태깅하고 어댑터에서 sourceMeta를 만든다", async () => {
    const a = fakeAdapter("alpha", { providesCost: true });
    const b = fakeAdapter("beta", { providesCost: false });
    const r = await collectSessions({}, [a, b]);
    expect(r.sessions.map((s) => s.source).sort()).toEqual(["alpha", "beta"]);
    expect(r.sourceMeta.get("alpha")?.providesCost).toBe(true);
    expect(r.sourceMeta.get("beta")?.providesCost).toBe(false);
  });

  it("실패한 어댑터는 warning으로 격리, 나머지는 유지", async () => {
    const good = fakeAdapter("good");
    const bad = fakeAdapter("bad", { fail: true });
    const r = await collectSessions({}, [good, bad]);
    expect(r.sessions.map((s) => s.source)).toEqual(["good"]);
    expect(r.warnings.some((w) => w.includes("bad"))).toBe(true);
  });

  it("claude-code 어댑터에만 paths/rootDir/sinceMtimeMs 전달, 타 소스엔 {}", async () => {
    let claudeOpts: CollectOptions | undefined;
    let otherOpts: CollectOptions | undefined;
    const claude = fakeAdapter("claude-code", { capture: (o) => (claudeOpts = o) });
    const other = fakeAdapter("other", { capture: (o) => (otherOpts = o) });
    await collectSessions({ sessionFiles: ["/x.jsonl"], sinceMtimeMs: 123 }, [claude, other]);
    expect(claudeOpts).toEqual({ paths: ["/x.jsonl"], sinceMtimeMs: 123 });
    expect(otherOpts).toEqual({});
  });

  it("sinceMtimeMs 미지정 시 collectOpts에 넣지 않는다(전체 수집)", async () => {
    let claudeOpts: CollectOptions | undefined;
    const claude = fakeAdapter("claude-code", { capture: (o) => (claudeOpts = o) });
    await collectSessions({}, [claude]);
    expect(claudeOpts).toEqual({});
  });

  it("실제 claudeCodeAdapter로 주입 세션 파일을 읽고 source 태깅", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimm-cs-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, assistantLine("2026-06-27T03:00:00Z"));
    const r = await collectSessions({ sessionFiles: [f] }, [claudeCodeAdapter]);
    expect(r.sessions.length).toBe(1);
    expect(r.sessions[0]?.source).toBe("claude-code");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("filterRecentByMtime + claudeCodeAdapter sinceMtimeMs", () => {
  it("mtime < cutoff 파일을 자동 발견에서 드롭한다(성근 프리필터)", async () => {
    const root = mkdtempSync(join(tmpdir(), "aimm-mtime-"));
    const proj = join(root, "proj");
    mkdirSync(proj);
    const recent = join(proj, "recent.jsonl");
    const old = join(proj, "old.jsonl");
    writeFileSync(recent, assistantLine("2026-06-27T03:00:00Z")); // mtime=now(방금 씀)
    writeFileSync(old, assistantLine("2026-01-01T03:00:00Z"));
    const past = new Date("2026-01-01T00:00:00Z");
    utimesSync(old, past, past); // old 파일 mtime을 과거로
    const cutoff = new Date("2026-06-20T00:00:00Z").getTime();

    const r = await claudeCodeAdapter.collect({ rootDir: root, sinceMtimeMs: cutoff });
    expect(r.sessions.length).toBe(1); // recent만 남음
    rmSync(root, { recursive: true, force: true });
  });

  it("명시 paths는 sinceMtimeMs와 무관하게 필터하지 않는다(호출자 존중)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimm-mtime2-"));
    const old = join(dir, "old.jsonl");
    writeFileSync(old, assistantLine("2026-01-01T03:00:00Z"));
    const past = new Date("2026-01-01T00:00:00Z");
    utimesSync(old, past, past);
    const cutoff = new Date("2026-06-20T00:00:00Z").getTime();
    // paths 명시 → 오래된 파일이어도 유지
    const r = await claudeCodeAdapter.collect({ paths: [old], sinceMtimeMs: cutoff });
    expect(r.sessions.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stat 실패 파일은 보존한다(과소집계 방지, 상한집합)", async () => {
    const kept = await filterRecentByMtime(["/does/not/exist.jsonl"], Date.parse("2999-01-01"));
    expect(kept).toEqual(["/does/not/exist.jsonl"]);
  });
});
