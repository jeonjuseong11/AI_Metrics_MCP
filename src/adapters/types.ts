/**
 * AI 사용 소스 어댑터 계약 (E3).
 *
 * 오케스트레이터는 이 인터페이스에만 의존하고, 어떤 소스의 저장 포맷·위치·파서도 모른다.
 * 새 소스(Cursor 등, E5)는 SourceAdapter를 구현해 주입하기만 하면 분석 파이프라인을 탄다.
 */

import type { ParseResult } from "../types.js";

/** 한 소스에서 사용 기록을 수집할 때의 옵션. 해석은 어댑터별(소스-특화). */
export interface CollectOptions {
  /** 명시 입력 위치(소스-특화: 파일 경로, DB 경로 등). 주어지면 자동 발견을 대체. */
  paths?: string[];
  /** 자동 발견 루트 오버라이드(테스트/커스텀 위치). */
  rootDir?: string;
}

/**
 * 구현체는 자기 소스의 발견·읽기·파싱을 캡슐화해 정규화된 ParseResult를 돌려준다.
 * 레코드/파일 단위 손상은 warning으로 격리하고 절대 throw로 전체를 중단하지 않는다(§4.4).
 * discover/read/parse는 소스별로 함께 변하므로 collect() 하나로 묶고 계약에 노출하지 않는다.
 */
export interface SourceAdapter {
  /** 안정적 기계 식별자. 예: "claude-code". */
  readonly id: string;
  /** 사람용 표시 이름. 예: "Claude Code". */
  readonly displayName: string;
  /** 발견 + 읽기 + 파싱 → 정규화 세션. */
  collect(opts?: CollectOptions): Promise<ParseResult>;
}
