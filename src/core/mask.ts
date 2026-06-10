/**
 * 비밀 마스킹 — 이 도구의 유일한 보안 경계 (부록 A "A1").
 *
 * 설계 결정:
 *  - 직접 정규식을 새로 발명하지 않는다. gitleaks의 검증된 룰셋에서 고신호
 *    패턴을 채용한다(아래 RULES). 런타임에 gitleaks 바이너리를 강제하지 않아
 *    PoC가 이식 가능하고 테스트 가능하다. 후속에 실제 gitleaks로 교체할 수
 *    있도록 maskSecrets() 한 함수 뒤로 격리한다.
 *  - **fail-closed**: 엔진(정규식 적용)이 에러를 내면 부분 마스킹 결과를
 *    돌려주지 않고 throw 한다. 호출부(LLM 전송 경계)는 throw를 받으면 전송을
 *    차단한다. "마스킹 안 된 텍스트가 새는 것"보다 "전송 실패"가 안전하다.
 *  - 가림 가시성(§4.3): 몇 개를 어떤 룰로 가렸는지 redactions로 반환.
 *
 *   ⚠️ '완벽한 차단'을 주장하지 않는다(§6). 룰셋은 변형된 비밀을 놓칠 수 있다.
 *   전송 전 사용자 확인 + .aimm-ignore가 함께 방어한다.
 */

export interface Redaction {
  ruleId: string;
}

export interface MaskResult {
  masked: string;
  redactions: Redaction[];
}

export class MaskerError extends Error {
  constructor(
    public readonly ruleId: string,
    cause: unknown,
  ) {
    super(`마스킹 엔진 실패(rule=${ruleId}): ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "MaskerError";
  }
}

interface Rule {
  id: string;
  /** global 플래그 필수(replace 전수 적용). 선형 패턴만 — 파국적 백트래킹 금지. */
  pattern: RegExp;
}

/**
 * gitleaks 룰셋에서 채용한 고신호 패턴(서브셋).
 * 순서: 블록형(private key) → 접두사 토큰 → 구조형(JWT) → 컨텍스트 할당.
 */
const RULES: Rule[] = [
  { id: "private-key", pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { id: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "openai-key", pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { id: "github-pat", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { id: "github-fine-grained-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { id: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g },
  {
    // 컨텍스트 할당: api_key / secret / token / password = "...". 16자 이상 값만.
    id: "assigned-secret",
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._/+-]{16,}["']?/gi,
  },
];

const REDACTION_PLACEHOLDER = (ruleId: string): string => `«REDACTED:${ruleId}»`;
/** 파국적 백트래킹/메모리 방어: 비정상적으로 긴 입력은 거부(fail-closed로 이어짐). */
const MAX_INPUT_LENGTH = 5_000_000;

/**
 * 텍스트에서 비밀을 마스킹한다.
 * - 성공: MaskResult(masked, redactions).
 * - 엔진 에러: MaskerError throw (fail-closed — 호출부가 전송 차단).
 */
export function maskSecrets(text: string): MaskResult {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new MaskerError("input-too-large", new Error(`length ${text.length} > ${MAX_INPUT_LENGTH}`));
  }

  const redactions: Redaction[] = [];
  let masked = text;

  for (const rule of RULES) {
    try {
      masked = masked.replace(rule.pattern, () => {
        redactions.push({ ruleId: rule.id });
        return REDACTION_PLACEHOLDER(rule.id);
      });
    } catch (err) {
      // 한 룰이라도 실패하면 부분 결과를 신뢰하지 않고 fail-closed.
      throw new MaskerError(rule.id, err);
    }
  }

  return { masked, redactions };
}

/** 가림 건수만 빠르게(승인 화면 "N개 비밀 가림" 표시용). */
export function countRedactions(result: MaskResult): number {
  return result.redactions.length;
}
