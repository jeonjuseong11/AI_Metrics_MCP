import { describe, expect, it } from "vitest";
import { toKstDateString, kstDayRange, yesterdayKst, commitsOnKstDay, sessionsOnKstDay } from "../src/core/day.js";
import type { Commit } from "../src/parse/git.js";
import type { NormalizedSession } from "../src/types.js";

describe("KST day boundary", () => {
  it("UTC 15:00은 다음 KST 날짜로 넘어간다", () => {
    expect(toKstDateString(new Date("2026-06-02T15:00:00Z"))).toBe("2026-06-03");
    expect(toKstDateString(new Date("2026-06-02T14:59:59Z"))).toBe("2026-06-02");
  });

  it("kstDayRange는 KST 자정을 UTC로 환산한다", () => {
    const { startUtc, endUtc } = kstDayRange("2026-06-03");
    expect(startUtc.toISOString()).toBe("2026-06-02T15:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-06-03T15:00:00.000Z");
  });

  it("yesterdayKst는 now 기준 KST 어제를 준다", () => {
    expect(yesterdayKst(new Date("2026-06-10T01:00:00Z"))).toBe("2026-06-09");
  });

  it("커밋을 author date의 KST 날짜로 필터한다", () => {
    const commits: Commit[] = [
      { hash: "a", shortHash: "a", author: "x", timestamp: new Date("2026-06-02T15:30:00Z"), subject: "after midnight KST" },
      { hash: "b", shortHash: "b", author: "x", timestamp: new Date("2026-06-02T14:00:00Z"), subject: "before" },
    ];
    expect(commitsOnKstDay(commits, "2026-06-03").map((c) => c.subject)).toEqual(["after midnight KST"]);
    expect(commitsOnKstDay(commits, "2026-06-02").map((c) => c.subject)).toEqual(["before"]);
  });

  it("자정 넘는 세션은 시작 시각 기준으로 귀속된다", () => {
    const sessions: NormalizedSession[] = [
      {
        sessionId: "s1",
        projectPath: undefined,
        messages: [],
        startTime: new Date("2026-06-02T15:30:00Z"), // KST 06-03 00:30
        endTime: new Date("2026-06-02T17:00:00Z"), // KST 06-03 02:00
      },
    ];
    expect(sessionsOnKstDay(sessions, "2026-06-03")).toHaveLength(1);
    expect(sessionsOnKstDay(sessions, "2026-06-02")).toHaveLength(0);
  });
});
