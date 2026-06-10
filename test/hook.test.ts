import { describe, expect, it, afterAll } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../src/core/hook.js";

const OUT = join(tmpdir(), "aimm-hook-test");

afterAll(async () => {
  await rm(OUT, { recursive: true, force: true });
});

describe("runHook", () => {
  it("정상: 초안을 draft-<date>.md로 쓰고 ok=true", async () => {
    const r = await runHook({ date: "2026-06-09", sessionFiles: [], outDir: OUT });
    expect(r.ok).toBe(true);
    expect(r.path).toContain("draft-2026-06-09.md");
    const body = await readFile(r.path, "utf-8");
    expect(body).toContain("# 일일 스크럼 — 2026-06-09");
  });

  it("실패해도 조용히 죽지 않고 에러 노트를 파일에 남긴다", async () => {
    // 잘못된 날짜 → 내부에서 throw → 에러 노트 폴백.
    const r = await runHook({ date: "baddate", sessionFiles: [], outDir: OUT });
    expect(r.ok).toBe(false);
    const body = await readFile(r.path, "utf-8");
    expect(body).toContain("자동 생성 실패");
  });
});
