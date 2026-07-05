import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function run(stdin: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, "session-start"], { input: stdin, encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("aimm session-start CLI", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error("run `npm run build` before this test");
  });

  it("startup → emits top-level systemMessage JSON, exit 0", () => {
    const { stdout, status } = run(JSON.stringify({ source: "startup", session_id: "x" }));
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(typeof out.systemMessage).toBe("string");
    expect(out.systemMessage.length).toBeGreaterThan(0);
    expect(out.systemMessage).toMatch(/^(🪞|⚠️)/);
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it("compact → no output, exit 0 (source filtered)", () => {
    const { stdout, status } = run(JSON.stringify({ source: "compact" }));
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("clear → no output, exit 0", () => {
    const { stdout, status } = run(JSON.stringify({ source: "clear" }));
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("empty stdin (unknown source) → no output, exit 0", () => {
    const { stdout, status } = run("");
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
