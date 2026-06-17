/**
 * AIMM 정규화 모델 (single source of truth).
 *
 * 부록 A의 "단일 파싱 패스" 결정: Claude Code JSONL을 한 번만 파싱해
 * 아래 정규화 타입을 만들고, 매칭·메트릭·렌더가 모두 이걸 공유한다.
 * 매칭/메트릭이 각자 JSONL을 또 파싱하면 DRY 위반 + 스키마 변경 시 두 곳 수정.
 *
 *   JSONL ──▶ parse(adapter) ──▶ NormalizedSession[] ──┬─▶ metrics
 *                                                       ├─▶ match (with git)
 *                                                       └─▶ render
 */

/** Claude Code JSONL `message.usage` 필드 (2026-06-10 실측 확인). */
export interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  /** 캐시 읽기 — 단가 ≈ 정가의 10%. 비용 산출 시 반드시 반영. */
  cache_read_input_tokens: number;
  /** 캐시 생성(쓰기) — 단가 ≈ 정가의 125%. */
  cache_creation_input_tokens: number;
}

/** 정규화된 토큰 사용량. 한 메시지 또는 합산 단위. */
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** 정규화된 단일 assistant 메시지. */
export interface NormalizedMessage {
  /** 모델 ID, 예: "claude-opus-4-8". 누락 시 "unknown". */
  model: string;
  /** UTC 타임스탬프. 표시·일자 귀속 시 로컬(KST)로 변환. */
  timestamp: Date;
  tokens: TokenTotals;
}

/** 한 Claude Code 세션(JSONL 파일 1개)을 정규화한 결과. */
export interface NormalizedSession {
  sessionId: string;
  /** 이 세션을 만든 소스 어댑터 id. 예: "claude-code", "cursor". 오케스트레이터가 스탬프. 미지정 시 집계에서 "(unknown)". */
  source?: string;
  /** 세션이 속한 프로젝트 경로(역슬러그). 없으면 undefined. */
  projectPath: string | undefined;
  messages: NormalizedMessage[];
  /** 세션 첫/마지막 메시지 시각. 메시지 0개면 둘 다 undefined. */
  startTime: Date | undefined;
  endTime: Date | undefined;
}

/** 파서가 레코드 단위 손상을 만났을 때 남기는 경고(중단하지 않음). */
export interface ParseWarning {
  /** 파일 내 1-based 라인 번호. */
  line: number;
  reason: string;
}

export interface ParseResult {
  sessions: NormalizedSession[];
  warnings: ParseWarning[];
}
