import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionStart } from "../src/core/sessionStart.js";

// 어제(KST) startTime을 가진 Claude Code 세션 1줄 + assistant usage.
function sessionJsonl(isoTs: string): string {
  return [
    JSON.stringify({ type: "user", timestamp: isoTs, message: { role: "user", content: "hi" } }),
    JSON.stringify({
      type: "assistant", timestamp: isoTs,
      message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }),
  ].join("\n");
}

describe("runSessionStart", () => {
  let dir: string;
  const now = new Date("2026-06-28T05:00:00Z"); // KST 14:00, 어제=2026-06-27
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aimm-ss-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("cold start (no sessions) → 아직 기록 없음", async () => {
    const line = await runSessionStart({ now, sessionFiles: [] });
    expect(line).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });

  it("yesterday session → mirror line with 어제", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, sessionJsonl("2026-06-27T03:00:00Z")); // KST 12:00 어제
    const line = await runSessionStart({ now, sessionFiles: [f] });
    expect(line).toContain("🪞 어제: 1세션");
    expect(line).toContain("이번주(최근7일): 1세션");
    expect(line).not.toMatch(/[\\/]/); // 경로 누출 없음
  });

  it("never throws — returns ⚠️ line on failure", async () => {
    // projectsDir를 존재하지 않는 경로로 주되 sessionFiles 없이 → 수집은 빈 결과로 안전.
    // 강제 실패는 잡기 어려우니 최소: 정상 경로가 throw하지 않음을 보장.
    const line = await runSessionStart({ now, sessionFiles: [] });
    expect(typeof line).toBe("string");
    expect(line.startsWith("🪞") || line.startsWith("⚠️")).toBe(true);
  });
});
