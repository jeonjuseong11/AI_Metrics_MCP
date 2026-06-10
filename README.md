# AIMM — AI-Metrics MCP

Claude Code 세션 로그 + Git 커밋을 로컬에서 결합해 **일일 스크럼 초안**과
**AI 사용 메트릭**(모델·토큰·추정 비용·세션 지속시간)을 자동 생성하는 PoC 도구.

기획·설계 배경: [AIMM_PoC_기획서_v2.md](./AIMM_PoC_기획서_v2.md)

## 원칙

- **로컬 우선** — 수집·1차 처리는 사용자 PC 안에서만. 외부 LLM에는 마스킹을 거친 요약 컨텍스트만, 사용자 승인 후 전송.
- **결정적 메트릭** — 토큰·비용은 로컬에서 결정적으로 계산하고 LLM을 우회한다(환각 차단). 캐시 토큰 단가 반영.
- **fail-closed 마스킹** — 마스커가 에러를 내면 전송을 차단한다. 검증된 비밀탐지 룰셋 채용.
- **정직한 표기** — "세션 지속(추정)"은 활동 시간이 아니며, 비용은 "추정·정산액 아님".

## 사용 (개발 중)

```bash
npm install
npm test          # 44 tests
npm run build

# 특정 세션 로그의 메트릭
npx tsx src/cli.ts metrics <session.jsonl>

# 일일 스크럼 초안 (세션 자동 발견 + git 커밋 수집)
npx tsx src/cli.ts standup --date 2026-06-09 --author "이름" --repo /path/to/repo
```

## 상태

코어 완성(파서·메트릭·마스킹·KST 일자·렌더·오케스트레이터, 44 테스트).
남은 것: LLM 요약 + 전송 boundary, SessionEnd hook / MCP 진입점, `.aimm-ignore`, `aimm init`.

## 구조

```
src/
  types.ts            정규화 모델(단일 파싱 패스)
  pricing.ts          단가 테이블(캐시 반영, 버전 명시)
  parse/              JSONL·git 파서(순수 함수)
  core/               metrics · day(KST) · mask · render · standup
  fs/                 디스크 I/O (sessions · git · discover)
  cli.ts              CLI 진입점
```
