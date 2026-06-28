import { describe, it, expect } from "vitest";
import { parseSessionSource, shouldMirror, toHookOutput } from "../src/core/sessionStart.js";

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
