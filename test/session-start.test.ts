import { describe, it, expect } from "vitest";
import { parseSessionSource, shouldMirror, toHookOutput, failureGlance } from "../src/core/sessionStart.js";

describe("session-start helpers", () => {
  it("parseSessionSource extracts source from stdin JSON", () => {
    expect(parseSessionSource(JSON.stringify({ source: "startup", session_id: "x" }))).toBe("startup");
    expect(parseSessionSource(JSON.stringify({ source: "compact" }))).toBe("compact");
  });
  it("parseSessionSource returns 'unknown' on empty/bad input", () => {
    expect(parseSessionSource("")).toBe("unknown");
    expect(parseSessionSource("not json")).toBe("unknown");
    expect(parseSessionSource(JSON.stringify({}))).toBe("unknown");
  });
  it("shouldMirror only on startup/resume", () => {
    expect(shouldMirror("startup")).toBe(true);
    expect(shouldMirror("resume")).toBe(true);
    expect(shouldMirror("compact")).toBe(false);
    expect(shouldMirror("clear")).toBe(false);
    expect(shouldMirror("unknown")).toBe(false);
  });
  it("toHookOutput puts systemMessage at TOP LEVEL (spike-confirmed)", () => {
    const out = JSON.parse(toHookOutput("🪞 hi"));
    expect(out.systemMessage).toBe("🪞 hi");
    expect(out.hookSpecificOutput).toBeUndefined();
  });
});

describe("failureGlance", () => {
  it("strips path separators from Error messages", () => {
    const result = failureGlance(new Error("ENOENT C:\\Users\\x /y"));
    expect(result).toMatch(/^⚠️/);
    expect(result).not.toMatch(/[\\/]/);
  });
  it("handles non-Error thrown values (no 'undefined' in output)", () => {
    const result = failureGlance("something went wrong");
    expect(result).toMatch(/^⚠️ AIMM 거울 생성 실패: /);
    expect(result).not.toContain("undefined");
    expect(result.length).toBeGreaterThan("⚠️ AIMM 거울 생성 실패: ".length);
  });
  it("falls back to 알 수 없는 오류 for empty message", () => {
    const result = failureGlance(new Error(""));
    expect(result).toContain("알 수 없는 오류");
  });
});
