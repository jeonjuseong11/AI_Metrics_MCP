import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("aimm today CLI", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error("run `npm run build` before this test");
  });

  it("today --sessions '' (빈 세션) → cold-start, exit 0", () => {
    const { stdout, status } = run(["today", "--sessions", ""]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });

  it("today (실제 히스토리) → 🪞로 시작, exit 0", () => {
    const { stdout, status } = run(["today"]);
    expect(status).toBe(0);
    expect(stdout.trim().startsWith("🪞")).toBe(true);
  });
});
