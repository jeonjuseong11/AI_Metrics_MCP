import { describe, expect, it, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiAdapter } from "../src/adapters/gemini.js";

const ROOT = join(tmpdir(), "aimm-gemini-test");

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

async function seed(uuid: string, updatedAts: string[]): Promise<void> {
  const dir = join(ROOT, uuid);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < updatedAts.length; i++) {
    await writeFile(join(dir, `art${i}.metadata.json`), JSON.stringify({ artifactType: "PLAN", summary: "s", updatedAt: updatedAts[i] }));
  }
}

describe("geminiAdapter (Antigravity, cost-unknown)", () => {
  it("uuid별 세션 + updatedAt에서 시간창, 토큰 0", async () => {
    await seed("uuid-1", ["2026-06-10T01:00:00Z", "2026-06-10T03:00:00Z"]);
    const r = await geminiAdapter.collect({ rootDir: ROOT });
    expect(r.sessions).toHaveLength(1);
    const s = r.sessions[0]!;
    expect(s.sessionId).toBe("uuid-1");
    expect(s.startTime?.toISOString()).toBe("2026-06-10T01:00:00.000Z");
    expect(s.endTime?.toISOString()).toBe("2026-06-10T03:00:00.000Z");
    expect(s.messages[0]!.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(s.content).toBeUndefined(); // 프롬프트 없음 → 내용 없음
  });

  it("providesCost=false", () => {
    expect(geminiAdapter.providesCost).toBe(false);
  });

  it("디렉터리 없으면 조용히 빈 결과", async () => {
    const r = await geminiAdapter.collect({ rootDir: join(ROOT, "none") });
    expect(r.sessions).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});
