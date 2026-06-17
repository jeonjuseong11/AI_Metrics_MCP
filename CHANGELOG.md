# Changelog

이 프로젝트의 단계별 진화 기록이다. 형식은 [Keep a Changelog](https://keepachangelog.com/),
버전은 각 EXPANSION 항목(E1~)마다 minor를 올린다. 상세 릴리스 노트는 `docs/releases/`에 있다.
작성 규칙·템플릿: [docs/releases/README.md](docs/releases/README.md).

## [0.4.0] — 2026-06-17 · E3 멀티소스 어댑터 인터페이스

AI 사용 소스를 `SourceAdapter` 계약(`id`·`displayName`·`collect`) 뒤로 격리. 오케스트레이터가
Claude Code 파일 구조를 직접 모르게 하고, 새 소스(E5)는 인터페이스 구현+주입으로 드롭인.
CLI·hook·MCP 무변경(기본 claudeCodeAdapter). 구조 작업(체감 기능 변화 없음). 테스트 123 → 133 그린.

→ 상세: [docs/releases/v0.4.0-e3-adapter-interface.md](docs/releases/v0.4.0-e3-adapter-interface.md)

## [0.3.0] — 2026-06-15 · E2 사용 패턴 발견

초상 `## 발견`에 세션 기반 사용 패턴(케이던스·요일 리듬·사용 추세·비용 급증일) 추가.
결정적·작은 n 가드. git 상관(생산성)은 후속 단계로. 테스트 109 → 123 그린.

→ 상세: [docs/releases/v0.3.0-e2-usage-patterns.md](docs/releases/v0.3.0-e2-usage-patterns.md)

## [0.2.0] — 2026-06-15 · E1 AI craft 초상

`aimm portrait` 명령 추가 — 공유용 AI craft 초상(텍스트+표만, 5필드, 결정적 미니 인사이트).
프로젝트명 비노출. 기존 분석 코어 재사용. 테스트 96 → 109 그린.

→ 상세: [docs/releases/v0.2.0-e1-craft-portrait.md](docs/releases/v0.2.0-e1-craft-portrait.md)

## [0.1.0] — 2026-06-15 · Phase 0 코어 + Phase 1 ①② (baseline 백필)

Claude Code 세션 로그 + Git 커밋을 로컬에서 결합해 일일 스크럼 초안과 개인 AI 사용 분석
문서를 생성하는 PoC 코어. 주간 내러티브(①)·작업 성격 신호(②) 포함. 테스트 96 그린.

→ 상세: [docs/releases/v0.1.0-phase-1-baseline.md](docs/releases/v0.1.0-phase-1-baseline.md)
