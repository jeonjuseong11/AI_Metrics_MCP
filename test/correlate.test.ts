import { describe, expect, it } from "vitest";
import { correlateCommits } from "../src/core/correlate.js";
import type { Commit } from "../src/parse/git.js";
import type { NormalizedSession } from "../src/types.js";

function commit(iso: string): Commit {
  return { hash: "h", shortHash: "h", author: "x", timestamp: new Date(iso), subject: "s" };
}
function session(startIso: string, endIso: string): NormalizedSession {
  return { sessionId: "s", projectPath: undefined, messages: [], startTime: new Date(startIso), endTime: new Date(endIso) };
}

describe("correlateCommits (시간 상관, 비용 귀속 아님)", () => {
  const s = [session("2026-06-10T01:00:00Z", "2026-06-10T03:00:00Z")];

  it("세션 창 안의 커밋은 겹침으로 센다", () => {
    const r = correlateCommits([commit("2026-06-10T02:00:00Z")], s);
    expect(r.withSession).toBe(1);
    expect(r.share).toBe(1);
  });

  it("±30분 pad 안이면 겹침(세션 종료 20분 후)", () => {
    const r = correlateCommits([commit("2026-06-10T03:20:00Z")], s);
    expect(r.withSession).toBe(1);
  });

  it("창 밖(2시간 후)은 안 셈", () => {
    const r = correlateCommits([commit("2026-06-10T05:00:00Z")], s);
    expect(r.withSession).toBe(0);
    expect(r.share).toBe(0);
  });

  it("혼합: 3커밋 중 2겹침", () => {
    const r = correlateCommits(
      [commit("2026-06-10T02:00:00Z"), commit("2026-06-10T02:30:00Z"), commit("2026-06-10T09:00:00Z")],
      s,
    );
    expect(r).toMatchObject({ totalCommits: 3, withSession: 2 });
    expect(r.share).toBeCloseTo(2 / 3, 6);
  });

  it("start/end 없는 세션은 창을 안 만든다", () => {
    const noTime: NormalizedSession = { sessionId: "s", projectPath: undefined, messages: [], startTime: undefined, endTime: undefined };
    const r = correlateCommits([commit("2026-06-10T02:00:00Z")], [noTime]);
    expect(r.withSession).toBe(0);
  });
});
