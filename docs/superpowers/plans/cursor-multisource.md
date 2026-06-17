# Cursor 어댑터 + 멀티소스 통합 (E5 + E4-lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans. 체크박스로 추적.

**Goal:** Cursor를 두 번째 소스로 추가해 analyze/portrait "도구별 사용" 표에 Cursor 행(비용 미상)을 띄운다. cost-unknown 소스는 byTool에만 기여(기존 집계 무오염). standup/hook은 claude-only 유지.

**Architecture:** `SourceAdapter.providesCost` + `NormalizedSession.source` + `cursorAdapter`(node:sqlite로 state.vscdb) + 오케스트레이터 멀티소스 수집(코어 기본 claude-only, cli/mcp가 `ANALYSIS_ADAPTERS` 주입) + `analyze`의 byTool(cost-unknown 격리) + 렌더.

**Tech Stack:** TS strict NodeNext, vitest, `node:sqlite`(engines≥22, @types/node ^22). 상세 설계·코드·테스트: [specs/cursor-multisource-design.md](../specs/cursor-multisource-design.md).

> **⚠️ git:** 에이전트가 커밋/푸시 가능하되 **푸시 전 컨펌**([[commits-user-handles]]). per-task 커밋 안 함 — 마지막 Task에서 커밋 게이트.

---

## Task 1: 의존성·계약·모델 기반 (TDD 불요 — 타입/설정)
- [ ] `package.json`: `engines.node` `>=22`, `devDependencies.@types/node` `^22.0.0`. `npm install`.
- [ ] `src/adapters/types.ts`: `SourceAdapter`에 `readonly providesCost: boolean`.
- [ ] `src/adapters/claudeCode.ts`: `providesCost: true` 추가.
- [ ] `src/types.ts`: `NormalizedSession`에 `source?: string`.
- [ ] 검증: `npm run typecheck` — claudeCodeAdapter 외 `providesCost` 누락 컴파일 에러 없는지(types.ts만 바뀜). 기존 테스트 영향 없음.

## Task 2: Cursor 어댑터 (TDD) — spec §6
- [ ] **실패 테스트** `test/cursor.test.ts`(spec §11 #1-7): node:sqlite로 임시 state.vscdb 픽스처 생성 헬퍼 + 7 케이스(계약값·paths·rootDir·부재(경고0)·테이블부재(warn)·BLOB·손상키/JSON).
- [ ] 실패 확인: `npx vitest run test/cursor.test.ts` → 모듈 없음.
- [ ] `src/adapters/cursor.ts` 구현(spec §6: existsSync 조용 skip → try{open+prepare+all}catch{warn} → BLOB 디코드 → 키 split 가드 → composerId 그룹 → 세션). `defaultCursorGlobalStorage()` 플랫폼별.
- [ ] 통과 확인.

## Task 3: 멀티소스 수집 + byTool (TDD) — spec §7, §8
- [ ] **실패 테스트** `test/multisource.test.ts`(spec §11 #8-11): 결정성/오염방지(spy), 멀티소스+blocker회귀(hasUnknownModel false·unknown행 없음·"단가미상" 없음), portrait Cursor 미상 행.
- [ ] 실패 확인.
- [ ] `src/core/analysis.ts`: `ToolBucket`·`byTool?` 옵셔널. `analyze(sessions, opts={}, sourceMeta=new Map())` — known() 판정, **기존 롤업은 cost-known 세션만**(aggregate(filter(known))), byTool은 전 소스 그룹.
- [ ] `src/core/standup.ts`: `adapter?`→`adapters?: SourceAdapter[]`(양 옵션). `ANALYSIS_ADAPTERS` export. 수집 로직(기본 `[claudeCodeAdapter]`, 소스 스탬프, 어댑터별 try/catch, sourceMeta). buildAnalysis가 `analyze(.,.,sourceMeta)`.
- [ ] 통과 확인.

## Task 4: 렌더 + production 주입 (TDD) — spec §9, §7
- [ ] `src/core/portrait.ts`: "도구별 사용"을 `a.byTool` 순회 + fallback(byTool 없음+sessions>0 → 단일 CC 행) + 캐비엇. 하드코딩 행·E4문구 제거.
- [ ] `src/core/render.ts` `renderAnalysis`: "## 도구별 사용" 섹션(byTool fallback 동일).
- [ ] `src/cli.ts` cmdAnalyze·cmdPortrait: `opts.adapters = ANALYSIS_ADAPTERS`.
- [ ] `src/mcp/server.ts` analyze 도구: `opts.adapters = ANALYSIS_ADAPTERS`.
- [ ] **마이그레이션**: `test/adapters.test.ts:120,135` `{adapter:fake}`→`{adapters:[fake]}`. `test/portrait.test.ts:46-50` E4 단언 교체.
- [ ] 통과 확인: `npm test` 전체 그린.

## Task 5: 검증 — spec §12
- [ ] `npm run typecheck`(에러0) · `npm run build`(dist/adapters/cursor.js) · `npm test`(전체 그린).
- [ ] 스모크: `node dist/cli.js analyze --start 2026-06-15 --end 2026-06-17` → "도구별 사용"에 Cursor 행. 부재 가정 경고0(테스트로). standup은 Cursor 미접촉 확인.

## Task 6: 릴리스 — spec §13
- [ ] `package.json` version 0.5.0(Task1에서 engines/types 이미). `docs/releases/v0.5.0-cursor-multisource.md`(before/after·검증·도그푸딩). `CHANGELOG.md`.
- [ ] `npm test` 재확인.

## Task 7: 커밋 게이트
- [ ] 스테이징 대상 + 커밋 메시지 제시 → 사용자 승인 후 커밋/푸시.

## Self-Review
- Spec 커버: §4-5→T1, §6→T2, §7-8→T3, §9→T4, §12→T5, §13→T6. blocker 5건 전부 spec에 반영됨(cost-unknown 격리·byTool 옵셔널·부재 조용·@types/node·adapters.test 마이그레이션).
- 타입 일관: `SourceAdapter`/`ToolBucket`/`ANALYSIS_ADAPTERS`/`source` 명칭 spec과 일치.
