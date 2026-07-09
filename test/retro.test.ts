import { describe, expect, it, afterAll } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRetroWrite } from "../src/core/retro.js";

const OUT = join(tmpdir(), "aimm-retro-test");
afterAll(async () => {
  await rm(OUT, { recursive: true, force: true });
});

describe("runRetroWrite", () => {
  it("회고를 retro-<end>.md로 쓰고 'AI 회고' 헤더를 넣는다", async () => {
    const r = await runRetroWrite({ start: "2026-06-01", end: "2026-06-07", sessionFiles: [], outDir: OUT });
    expect(r.written).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.path).toContain("retro-2026-06-07.md");
    expect(await readFile(r.path, "utf-8")).toContain("# AI 회고");
  });

  it("같은 창(end) 파일이 있으면 재생성 skip(주간 멱등)", async () => {
    const first = await runRetroWrite({ start: "2026-06-08", end: "2026-06-14", sessionFiles: [], outDir: OUT });
    expect(first.written).toBe(true);
    const second = await runRetroWrite({ start: "2026-06-08", end: "2026-06-14", sessionFiles: [], outDir: OUT });
    expect(second.written).toBe(false); // skip
    expect(second.ok).toBe(true);
  });

  it("--force면 있어도 덮어쓴다", async () => {
    await runRetroWrite({ start: "2026-06-08", end: "2026-06-21", sessionFiles: [], outDir: OUT });
    const forced = await runRetroWrite({ start: "2026-06-08", end: "2026-06-21", sessionFiles: [], outDir: OUT, force: true });
    expect(forced.written).toBe(true);
  });
});
