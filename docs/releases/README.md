# 릴리스 노트 작성 규칙

각 EXPANSION 항목(E1~)을 spec→plan→구현으로 끝내지 않고 **"무엇이 어떻게 바뀌었나"의
증거로 닫는다.** 설계: [../superpowers/specs/2026-06-15-release-tracking-design.md](../superpowers/specs/2026-06-15-release-tracking-design.md).

## 규칙
- **단위:** E당 릴리스 1개. **버전:** E당 minor bump(E1→0.2.0, E2→0.3.0…). `package.json` version 동반 상승.
- **파일명:** `docs/releases/YYYY-MM-DD-vX.Y.Z-<slug>.md`. `<slug>`에 E 번호 포함(예 `e1-craft-portrait`).
- **인덱스:** 루트 `CHANGELOG.md`에 한 줄 요약 + 상세 링크를 역순(최신 위)으로 추가.
- **편입:** 각 E 구현 plan의 **마지막 task**로 "릴리스 노트 작성 + CHANGELOG 갱신 + version bump"를 넣는다.
- **커밋:** 사용자가 직접(저장소 규칙).
- **마스킹(fail-closed):** AI 메타는 `analyze`의 `AI-Metrics-MCP` 줄만 추출(타 프로젝트명 금지).
  before/after 샘플은 이 레포 자체 데이터만. 의심되면 가린다.

## AI 사용 메타 측정(도그푸딩)
```bash
node dist/cli.js analyze 2>&1 | sed -n '/## 프로젝트별/,/^---/p' | grep "AI-Metrics-MCP"
```
정직성 라벨 필수: 기간 근사·양이지 실력 아님·시간은 세션 지속 추정.

## 정규 템플릿
```markdown
# E# — <제목>  (vX.Y.Z · YYYY-MM-DD)

## 한 줄 요약
무엇이 가능해졌나 — 사용자가 보는 변화 한 문장.

## 산출물 before/after        (필수)
**before** (E 적용 전 CLI 출력 샘플):
...
**after** (E 적용 후 출력 샘플):
...

## 검증                        (필수)
- 테스트: N → M (신규 K개) · tsc/build 그린 · 적대적 검증 N건(해당 시)

## AI 사용 메타 — 도그푸딩       (필수)
- AI-Metrics-MCP 세션 N · 추정 비용 $N (기간 YYYY-MM-DD ~ YYYY-MM-DD)
> ⚠️ 기간 근사·전체 사용·시간은 세션 지속 추정. 양이지 실력 아님.

## 런타임 벤치                  (선택 — 해당 E만; 대개 "N/A: 핫패스 아님")
## 본인 메모                    (선택)
```
