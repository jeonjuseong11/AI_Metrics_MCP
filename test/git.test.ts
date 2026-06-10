import { describe, expect, it } from "vitest";
import { parseGitLog, GIT_LOG_FORMAT } from "../src/parse/git.js";

const F = "\x1f";
const R = "\x1e";

function rec(hash: string, short: string, author: string, iso: string, subject: string): string {
  return [hash, short, author, iso, subject].join(F) + R;
}

describe("parseGitLog", () => {
  it("정상 git log 출력을 Commit[]로 파싱한다", () => {
    const out =
      rec("a3f9c21abc", "a3f9c21", "전주성", "2026-06-09T10:00:00+09:00", "parse: handle multiline tool_result") +
      rec("7b1e004def", "7b1e004", "전주성", "2026-06-09T11:30:00+09:00", "fix: skip merge commits");
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.shortHash).toBe("a3f9c21");
    expect(commits[0]!.subject).toBe("parse: handle multiline tool_result");
    expect(commits[0]!.timestamp.toISOString()).toBe("2026-06-09T01:00:00.000Z");
  });

  it("필드 부족·빈 레코드는 skip한다", () => {
    const out = "incomplete" + R + rec("h", "h", "a", "2026-06-09T10:00:00Z", "ok") + R;
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe("ok");
  });

  it("비정상 날짜 레코드는 skip한다", () => {
    const out = rec("h", "h", "a", "not-a-date", "bad") + rec("h2", "h2", "a", "2026-06-09T10:00:00Z", "good");
    const commits = parseGitLog(out);
    expect(commits.map((c) => c.subject)).toEqual(["good"]);
  });

  it("GIT_LOG_FORMAT은 필드/레코드 구분자를 포함한다", () => {
    expect(GIT_LOG_FORMAT).toContain(F);
    expect(GIT_LOG_FORMAT).toContain(R);
  });
});
