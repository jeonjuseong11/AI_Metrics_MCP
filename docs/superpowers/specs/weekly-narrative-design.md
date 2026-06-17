# 주간 내러티브 (Phase 1 ①) — 설계

작성일: 2026-06-14 · 단계: Phase 1 ①(주간/월간 내러티브화) · 선행: Phase 0 완료

기획 배경: [AIMM_PoC_기획서_v2.md](../../../AIMM_PoC_기획서_v2.md) · 로드맵: [ROADMAP.md](../../../ROADMAP.md)

## 목표

결정적 사용 분석(`analyze`)이 내는 표·막대 위에, "이번 주는 이렇게 썼다"를 짧은
한국어 산문으로 얹는다. 신규 데이터 수집 없이 Phase 0의 Claude Code JSONL 한 소스에서
가장 빠르게 나오는 가치이며, 1순위 목적인 **개인 상향식 셀프 어필**과 직결된다.

## 변하지 않는 원칙 (이 기능에 적용)

- **결정적 메트릭은 LLM 우회.** LLM에 보내는 것은 이미 결정적으로 계산된 집계 사실
  블록뿐. 산문은 그 숫자를 *서술*할 뿐 새 숫자를 만들지 않는다.
- **로컬·프라이버시 우선.** 외부 전송은 마스킹(fail-closed) + 사용자 승인(`--send`)
  후에만. 기본은 전송 없는 결정적 문서.
- **서술이지 평가가 아님.** "이렇게 쓴다"를 보여주되 "잘 쓴다"고 주장하지 않는다.

## 아키텍처 / 데이터 흐름

```
analyze (결정적 UsageAnalysis)
        │
        ├──────────────────────────────▶ renderAnalysis (표/막대/스파크라인)
        │                                          ▲
        └─ buildNarrativeContext(사실블록)          │ 산문 섹션 주입
              └─ maskSecrets(fail-closed) ─[--send]─▶ narrator(LLM) ─▶ "## 한 주 돌아보기"
```

- LLM 입력 = 결정적 집계 사실 블록(모델믹스 %, 시간대 분포, 프로젝트별 비중,
  일자별 추세, 가장 활발한 날). 원시 커밋·대화는 보내지 않는다.
- 결정적 표는 문서에 그대로 남아 독자가 산문을 대조 검증할 수 있다.
- 기본 `analyze`는 결정적 문서만. `--send` 했을 때만 맨 위에 산문 섹션 추가.
- MCP `analyze` 도구는 결정적만 유지(MCP는 전송하지 않는다 — 기존 원칙).

standup의 마스킹 전송 경계(`summarize.ts`)와 대칭 구조. 입력과 프롬프트가 다르므로
억지로 공통화하지 않고 분석용 경계를 별도 파일로 격리한다.

## 파일 / 컴포넌트

### 신규

- `src/core/narrative.ts` — 분석 사실용 전송 경계(summarize.ts의 분석판).
  - `buildNarrativeContext(analysis: UsageAnalysis): string` — 사실 블록 텍스트(마스킹 전 원본).
  - `prepareNarrativeSend(analysis): { maskedContext, redactions }` — 마스킹(fail-closed).
    `maskSecrets`가 throw하면 그대로 전파(전송 차단).
  - `narrateUsage(analysis, narrator: Summarizer): Promise<{ prose, redactions }>` —
    마스킹된 사실 블록을 내레이터에 보내 산문을 얻는다. 세션 0건/빈 응답은 `SummarizerError`.
- `test/narrative.test.ts` — 위 함수들 + buildAnalysis 통합 경로 테스트.

### 수정

- `src/llm/anthropic.ts` — `createAnthropicNarrator()` 추가. 내부 공용 헬퍼로 묶고
  시스템 프롬프트만 다르게 한다(요약기 = "어제 한 일" 스크럼, 내레이터 = "주간 서술 +
  수치 날조 금지"). `Summarizer` 타입(`(masked: string) => Promise<string>`) 그대로 재사용.
- `src/core/standup.ts` — `buildAnalysis`에 `useLlm`/`dryRunLlm`/`summarizer` 옵션 추가,
  결과에 `narrative`/`preview`/`warnings` 추가. `buildStandup`의 LLM·드라이런·폴백 분기를 미러링.
- `src/core/render.ts` — `renderAnalysis(a, author?, narrative?)`. narrative가 있으면
  요약 섹션 위에 `## 한 주 돌아보기` 산문 섹션 삽입. 없으면 기존과 동일(회귀 없음).
- `src/cli.ts` — `cmdAnalyze`에 `--llm`/`--send` 추가. 드라이런 미리보기를 stderr로 출력
  (cmdStandup과 동일 패턴). `--week`는 채택하지 않음(`--start`/`--end`로 충분).
- `src/mcp/server.ts` — 변경 없음.

## 환각 차단

사실 블록은 결정적 수치를 라벨과 함께 보내 LLM이 그대로 인용하게 한다:

```
[기간] 2026-06-08 ~ 2026-06-14 (KST)
[총계] 세션 23 · 활동일 6 · 비용 약 $4.10
[모델믹스] Opus 62% 토큰/$3.10 · Sonnet 28% · Haiku 10%
[시간대] 피크 14~17시 (오후 집중) · 오전 거의 없음
[프로젝트] AI_Metrics_MCP 70% · AIWS-Front 30%
[가장 활발] 2026-06-12 ($1.40)
```

내레이터 시스템 프롬프트 제약:
- 사실 블록에 없는 수치·지표·성과를 절대 생성하지 않는다. 정량 주장은 블록의 값만 인용.
- 서술이지 평가가 아니다 — "잘 썼다"가 아니라 "이렇게 썼다". 토큰은 양이지 실력이 아니다.
- 한국어 산문 2~4문장, 머리말·맺음말 없이.
- 표가 문서에 남으므로 산문은 패턴 해석에 집중("오후에 집중", "프로젝트 X에 Opus 편중").

## 마스킹

사실 블록도 `maskSecrets`(fail-closed)를 통과한다. 프로젝트 슬러그 등에 토큰·키가
섞여 있어도 가린다. mask가 throw하면 전송하지 않고 결정적 문서로 폴백 + warning.

## 에러 처리 / 폴백

- API 키 없음·타임아웃·빈 응답·거부 → `SummarizerError` → 결정적 문서만 출력 + warning.
- 마스킹 throw → 전송 차단 → 결정적 문서만 + warning.
- 세션 0건 → 산문 생략(기존 "세션 없음" 문서 그대로).
- 어떤 실패도 결정적 분석 문서 출력을 막지 않는다.

## 테스트 전략 (TDD, fake narrator 주입 — API 키 불필요)

`test/narrative.test.ts`:
1. `buildNarrativeContext` — 모델믹스·시간대·프로젝트 수치가 라벨과 함께 블록에 포함(스냅샷).
2. `prepareNarrativeSend` — 슬러그에 심은 가짜 시크릿이 가려지고 redaction이 잡힘.
   mask throw 시 전파(전송 차단).
3. `narrateUsage` — 세션 0건이면 `SummarizerError`로 스킵 / fake narrator 산문 반환 /
   빈 응답 거부.
4. `buildAnalysis` — 드라이런 → `preview`만 채워지고 전송 안 함 / narrator 주입 →
   `narrative` 채워짐 / narrator 실패 → 결정적 문서 폴백 + warning.
5. `renderAnalysis` — narrative 주면 `## 한 주 돌아보기` 섹션 삽입, 없으면 기존과 동일.

기존 61개 테스트는 옵셔널 시그니처 추가만 하므로 전부 통과 유지.

## 비목표 (이번 슬라이스 제외)

- 상황(situation) 신호 — 커밋 타입/파일 종류로 "무슨 작업"을 추정하는 건 Phase 1 ②.
- 추세·이상치 탐지 — Phase 1 ③.
- PDF/공유 산출물 export — Phase 1 ④.
- 멀티 LLM 어댑터 — Phase 2.
