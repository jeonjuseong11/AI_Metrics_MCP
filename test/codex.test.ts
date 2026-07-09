import { describe, expect, it } from "vitest";
import { parseCodexSession } from "../src/parse/codex.js";

const line = (o: unknown) => JSON.stringify(o);

const fixture = [
  line({ timestamp: "2026-03-11T13:00:00.000Z", type: "session_meta", payload: { id: "sess-1", cwd: "C:/repo/j-com" } }),
  line({ timestamp: "2026-03-11T13:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.3-codex", cwd: "C:/repo/j-com" } }),
  line({ timestamp: "2026-03-11T13:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "구현해줘" } }),
  line({ timestamp: "2026-03-11T13:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "git status && cd /x" }) } }),
  line({ timestamp: "2026-03-11T13:00:04.000Z", type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** Update File: src/a.ts\n+x\n*** End Patch" }) } }),
  line({ timestamp: "2026-03-11T13:00:05.000Z", type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: "{}" } }),
  line({ timestamp: "2026-03-11T13:00:06.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50, reasoning_output_tokens: 10 } } } }),
  "{ broken json",
  line({ timestamp: "2026-03-11T13:00:10.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0 } } } }),
].join("\n");

describe("parseCodexSession", () => {
  it("session_meta·turn_context에서 id·cwd·model을 잡는다", () => {
    const { session } = parseCodexSession(fixture, "fb");
    expect(session.sessionId).toBe("sess-1");
    expect(session.projectPath).toBe("C:/repo/j-com");
    expect(session.messages[0]!.model).toBe("gpt-5.3-codex");
  });

  it("last_token_usage를 매핑한다(캐시→cacheRead, reasoning→output)", () => {
    const { session } = parseCodexSession(fixture, "fb");
    expect(session.messages).toHaveLength(2);
    // input 1000 - cached 400 = 600, output 50+10=60, cacheRead 400
    expect(session.messages[0]!.tokens).toEqual({ input: 600, output: 60, cacheRead: 400, cacheCreation: 0 });
  });

  it("도구를 공유 어휘로 정규화하고 명령동사·확장자를 뽑는다", () => {
    const { session } = parseCodexSession(fixture, "fb");
    const c = session.content!;
    expect(c.userPrompts).toBe(1);
    expect(c.toolUses).toEqual({ Bash: 1, Edit: 1, TodoWrite: 1 }); // shell_command→Bash, apply_patch→Edit, update_plan→TodoWrite
    expect(c.commandVerbs).toEqual({ git: 1 }); // cd 스킵
    expect(c.fileExts).toEqual({ ".ts": 1 });
    // 원시 경로·명령 미저장
    expect(JSON.stringify(c)).not.toContain("/x");
    expect(JSON.stringify(c)).not.toContain("src/a");
  });

  it("깨진 라인은 skip+warning, 나머지 정상 처리", () => {
    const { warnings } = parseCodexSession(fixture, "fb");
    expect(warnings.length).toBe(1);
  });

  it("빈 입력은 메시지 0·content 생략", () => {
    const { session } = parseCodexSession("\n\n", "fb");
    expect(session.messages).toHaveLength(0);
    expect(session.content).toBeUndefined();
  });
});
