import { describe, expect, it } from "vitest";
import { parseCopilotSession } from "../src/adapters/copilot.js";

const T0 = new Date("2026-06-10T01:00:00Z").getTime();

const fixture = JSON.stringify({
  sessionId: "sess-cop",
  creationDate: T0,
  lastMessageDate: T0 + 3600000,
  requests: [
    { message: { text: "이 프로젝트 분석해줘" }, timestamp: T0, modelId: "copilot/gpt-5-mini" },
    { message: { text: "리팩터링 해줘" }, timestamp: T0 + 1800000, modelId: "copilot/gpt-4.1" },
    { message: { text: "" }, timestamp: T0 + 1900000, modelId: "copilot/gpt-4.1" }, // 빈 텍스트 → userPrompts 불포함
  ],
});

describe("parseCopilotSession", () => {
  it("requests에서 프롬프트·시각·모델을 뽑고 토큰은 0(cost-unknown)", () => {
    const { session } = parseCopilotSession(fixture, "fb");
    expect(session.sessionId).toBe("sess-cop");
    expect(session.messages).toHaveLength(3); // 시각 있는 요청 3건
    expect(session.messages[0]!.model).toBe("copilot/gpt-5-mini");
    expect(session.messages[0]!.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(session.content?.userPrompts).toBe(2); // 빈 텍스트 제외
    expect(session.startTime?.toISOString()).toBe("2026-06-10T01:00:00.000Z");
  });

  it("깨진 JSON은 skip+warning, 빈 세션 반환(throw 안 함)", () => {
    const { session, warnings } = parseCopilotSession("{bad", "fb");
    expect(session.messages).toHaveLength(0);
    expect(warnings.length).toBe(1);
  });

  it("requests 없으면 메시지 0·content 생략", () => {
    const { session } = parseCopilotSession(JSON.stringify({ sessionId: "x" }), "fb");
    expect(session.messages).toHaveLength(0);
    expect(session.content).toBeUndefined();
  });
});
