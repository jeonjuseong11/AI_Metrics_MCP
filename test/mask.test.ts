import { describe, expect, it } from "vitest";
import { maskSecrets, MaskerError } from "../src/core/mask.js";

/** 전부 가짜(예시) 비밀 — 형식만 실제 패턴과 일치. */
const SECRETS: { id: string; sample: string }[] = [
  { id: "aws-access-key-id", sample: "AKIAIOSFODNN7EXAMPLE" },
  { id: "github-pat", sample: "ghp_012345678901234567890123456789012345" },
  { id: "github-fine-grained-pat", sample: "github_pat_11ABCDE0123456789abcdef" },
  { id: "openai-key", sample: "sk-abcdefghijklmnopqrstuvwxyz012345" },
  { id: "anthropic-key", sample: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" },
  { id: "google-api-key", sample: "AIzaSyA0123456789abcdefghijklmnopqrstuv" },
  { id: "slack-token", sample: "xoxb-1234567890-abcdefghijABCDEF" },
  { id: "jwt", sample: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N" },
  { id: "bearer-token", sample: "Bearer abcdefghijklmnop1234567890ABCD" },
];

describe("maskSecrets — 적대적 커버리지", () => {
  for (const { id, sample } of SECRETS) {
    it(`${id} 비밀을 가린다`, () => {
      const text = `로그: 토큰은 ${sample} 입니다.`;
      const r = maskSecrets(text);
      expect(r.masked).not.toContain(sample);
      expect(r.redactions.map((x) => x.ruleId)).toContain(id);
    });
  }

  it("private key 블록 전체를 가린다", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabcDEF123456789==\nGHIJKLmnop==\n-----END RSA PRIVATE KEY-----";
    const r = maskSecrets(`키:\n${key}\n끝`);
    expect(r.masked).not.toContain("MIIEabcDEF");
    expect(r.masked).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(r.redactions.map((x) => x.ruleId)).toContain("private-key");
  });

  it("할당형 비밀(api_key = \"...\")을 가린다", () => {
    const r = maskSecrets(`config: api_key = "Abc123Def456Ghi789Xyz" 끝`);
    expect(r.masked).not.toContain("Abc123Def456Ghi789Xyz");
    expect(r.redactions.map((x) => x.ruleId)).toContain("assigned-secret");
  });

  it(".env 스타일 API_KEY=값을 가린다", () => {
    const r = maskSecrets("API_KEY=sk_live_0123456789abcdef0123");
    expect(r.masked).not.toContain("sk_live_0123456789abcdef0123");
    expect(r.redactions.length).toBeGreaterThan(0);
  });

  it("정상 텍스트를 과잉 마스킹하지 않는다", () => {
    const benign = "오늘 api 설계를 논의했고 password 정책과 token 만료를 검토했다. 3시에 회의.";
    const r = maskSecrets(benign);
    expect(r.masked).toBe(benign);
    expect(r.redactions).toHaveLength(0);
  });

  it("짧은 값(16자 미만)은 비밀로 보지 않는다", () => {
    const r = maskSecrets("token: abc123");
    expect(r.redactions).toHaveLength(0);
  });

  it("여러 비밀의 가림 건수를 정확히 센다", () => {
    const text = `${SECRETS[0]!.sample} 그리고 ${SECRETS[3]!.sample}`;
    const r = maskSecrets(text);
    expect(r.redactions.length).toBe(2);
  });

  it("fail-closed: 비정상적으로 큰 입력은 MaskerError를 던진다(부분 결과 금지)", () => {
    const huge = "x".repeat(5_000_001);
    expect(() => maskSecrets(huge)).toThrow(MaskerError);
  });
});
