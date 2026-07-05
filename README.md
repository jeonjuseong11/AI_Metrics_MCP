# AIMM — AI-Metrics MCP

> Claude Code 세션 로그와 Git 커밋을 **로컬에서** 결합해
> **일일 스크럼 초안**과 **AI 사용 메트릭**(모델·토큰·추정 비용·세션 지속시간)을
> 자동 생성하는 사내 PoC 도구.

기획·설계 배경 전체: [AIMM_PoC_기획서_v2.md](./AIMM_PoC_기획서_v2.md)
(office-hours → CEO 리뷰 → 엔지니어링 리뷰를 거친 제안서)

---

## 무엇을, 왜

개발팀은 Claude Code 같은 AI 도구를 매일 쓰지만 그 기록은 각 도구에 흩어져 있다.
이로 인해 두 가지 비용이 생긴다.

1. **회사** — 매달 AI 구독료를 내면서도 그 돈이 어디에 쓰이는지 보여줄 데이터가 0이다.
   구독 갱신·좌석 수 결정이 전부 감으로 이루어진다.
2. **구성원** — 일일 스크럼·주간 보고를 쓸 때마다 AI 대화와 Git 로그를 수동으로 되짚는다.

AIMM은 **보고 시간 절감을 미끼로 도구를 매일 켜게 만들고**, 그 부산물로
**신뢰 가능한 AI 사용 데이터셋**을 쌓는다. 채택이 데이터셋을 살아있게 유지하는 엔진이다.

> 본 도구는 'AI로 개발 속도 X% 향상' 같은 인과적 ROI 수치를 만들지 않는다.
> 통제된 비교 없이는 산출할 수 없고, 근거 없는 수치는 신뢰를 떨어뜨린다.
> AIMM이 제공하는 것은 **검증 가능한 사용 기록과 보고 작성 시간 절감**이다.

## 핵심 원칙

| 원칙 | 의미 |
|------|------|
| **로컬 우선** | 수집·1차 처리는 사용자 PC 안에서만. 외부 LLM에는 마스킹을 거친 요약 컨텍스트만, 사용자 승인 후 전송. 원본 JSONL·전체 diff는 PC를 떠나지 않는다. |
| **결정적 메트릭** | 토큰·비용은 로컬에서 결정적으로 계산하고 **LLM을 우회**한다(환각 차단). LLM은 토큰 숫자를 보거나 생성하지 않는다. |
| **fail-closed 마스킹** | 마스커가 에러를 내면 전송을 **차단**한다. 검증된 비밀탐지 룰셋을 채용한다(직접 정규식 발명 아님). |
| **정직한 표기** | "세션 지속(추정)"은 활동 시간이 아니다. 비용은 항상 "추정·정산액 아님". 커밋 해시 근거를 모든 항목에 표기한다. |

## 동작 방식

```
Claude Code JSONL ─┐
                   ├─▶ 파서 ─▶ 정규화 모델 ─┬─▶ 메트릭(결정적, LLM 우회)
Git log ───────────┘    (단일 패스)         ├─▶ KST 일자 필터
                                            └─▶ 렌더 ─▶ 스크럼 초안
                                                  ▲
                    LLM 요약 ◀─ 사용자 승인 ◀─ 마스킹(fail-closed) ◀─ 커밋 컨텍스트
```

- **단일 파싱 패스**: JSONL을 한 번만 파싱해 정규화 모델(turn·model·tokens·timestamp)을
  만들고 메트릭·매칭·렌더가 공유한다(DRY).
- **메트릭은 LLM을 거치지 않는다**: 토큰 합 × 단가(캐시 반영)로 로컬 계산 후 초안에 주입.
- 현재 "어제 한 일"은 커밋 목록(해시 근거 포함) 형태다. LLM 요약은 그 위에 얹는 다음 단계이며,
  LLM 실패 시 이 형태가 그대로 안전한 폴백이 된다.

## 설치 & 사용

```bash
git clone <repo-url> && cd AI_Metrics_MCP
npm install            # prepare 훅이 dist/를 자동 빌드 (클론 직후 바로 사용 가능)
npm test               # (선택) 테스트 확인
node dist/cli.js init  # (선택) SessionEnd hook·MCP 자동 등록 — 아래 "Claude Code 연동" 참고
```

> `dist/`는 gitignore이지만 `prepare` 훅 덕분에 `npm install`만으로 빌드된다 — 클론 직후
> `claude mcp add … node <ABS>/dist/cli.js mcp`가 바로 동작한다(별도 `npm run build` 불필요).

### 세션 로그의 메트릭만 보기

```bash
npx tsx src/cli.ts metrics <session.jsonl> [<session2.jsonl> ...]
```

```
## AI 사용 메트릭 (자동 추출)
- 모델: Opus 1495k tok  |  세션 1건, 지속(추정) 3m
- 추정 비용: 약 $5.81 (토큰×공시 단가 v2026-06-10 기준, 정산액 아님)
```

### 일일 스크럼 초안 생성

```bash
npx tsx src/cli.ts standup \
  --date 2026-06-09 \           # 대상 KST 날짜(기본: 어제)
  --author "전주성" \           # git 작성자 필터 + 초안 헤더
  --repo /path/to/repo          # 커밋 수집 저장소(선택)
# --sessions <file>             # 세션 파일 명시(반복 가능; 기본: ~/.claude/projects 자동 발견)
```

```markdown
# 일일 스크럼 — 2026-06-09 (전주성)

## 어제 한 일
- parse: handle multiline tool_result
  근거: `a3f9c21` parse: handle multiline tool_result

## AI 사용 메트릭 (자동 추출)
- 모델: Opus 38k tok · Sonnet 12k tok  |  세션 3건, 지속(추정) 2.7h
- 추정 비용: 약 $1.40 (토큰×공시 단가 v2026-06-10 기준, 정산액 아님)

---
⚠️ 이 초안은 커밋·세션 로그 기반 자동 생성입니다. 수치·성과를 임의로 추가하지 않았으며,
   메트릭은 로그 토큰에서 산출(활동 시간 아님), 세션은 시작 시각(KST) 기준 귀속,
   제출 전 본인 검토가 필요합니다.
```

빈 날(커밋 0 + 세션 0)에는 깨진 초안 대신 "오늘 기록된 활동 없음"을 낸다.

### LLM 요약 (전송 경계)

`--llm`은 "어제 한 일"을 커밋 목록 대신 LLM 산문으로 요약한다. **기본은 드라이런** —
마스킹을 거쳐 *실제로 전송될 내용*과 "N개 비밀 가림"만 보여주고 전송하지 않는다.

```bash
# 드라이런: 보낼 내용 + 가림 건수만 확인(전송 안 함)
npx tsx src/cli.ts standup --repo /path/to/repo --date 2026-06-09 --llm

# 실제 전송(저가 모델 haiku, ANTHROPIC_API_KEY 필요)
ANTHROPIC_API_KEY=sk-ant-... npx tsx src/cli.ts standup --repo /path/to/repo --llm --send
```

요약 실패(키 없음·타임아웃·빈 응답)는 자동으로 커밋 목록 폴백 + 에러 노트로 떨어진다(§4.4).
요약 모델은 `AIMM_SUMMARY_MODEL`로 바꿀 수 있다.

### 개인 AI 사용 분석 문서

```bash
npx tsx src/cli.ts analyze --author "이름" --start 2026-06-01 --end 2026-06-10
```

모델 믹스·일자별 비용 추세·시간대(KST) 분포·프로젝트별·가장 활발한 날을
결정적으로 계산해 마크다운으로 낸다. **기본은 결정적-only**(LLM·API 불요). "내가
평소에 AI를 어떻게 쓰는지"를 보여주는 셀프 리뷰 자료(평가가 아닌 서술).

`--llm`을 붙이면 standup과 동일한 전송 경계로 **주간 내러티브 산문**을 더한다.
**기본은 드라이런** — 마스킹을 거쳐 LLM에 보낼 결정적 "사실 블록"과 가림 건수만
보여주고 전송하지 않는다. `--send` 시에만 실제 전송해 문서 맨 위에 `## 한 주
돌아보기` 산문을 넣는다(결정적 표는 그대로 남는다). 내레이터 모델은
`AIMM_NARRATIVE_MODEL`로 바꿀 수 있고, 실패(키 없음·타임아웃 등)는 결정적 문서로
자동 폴백한다.

```bash
# 드라이런: 보낼 사실 블록 + 가림 건수만(전송 안 함)
npx tsx src/cli.ts analyze --start 2026-06-08 --end 2026-06-14 --llm

# 실제 전송(저가 모델 haiku, ANTHROPIC_API_KEY 필요)
ANTHROPIC_API_KEY=sk-ant-... npx tsx src/cli.ts analyze --start 2026-06-08 --end 2026-06-14 --llm --send
```

> MCP `analyze` 도구는 결정적 문서만 반환한다(외부 전송 없음) — 산문은 CLI `--send` 전용.

### Claude Code 연동 (hook · MCP)

**원커맨드:** `node dist/cli.js init` 한 번이면 아래 ①②를 자동 등록한다 — `~/.claude/settings.json`에
SessionEnd hook을 멱등 병합(타임스탬프 백업)하고, `claude`가 있으면 `claude mcp add --scope user`로
MCP를 등록(없으면 `.mcp.json` 폴백 + 명령 출력)한다. `--dry-run`으로 변경 예정만 미리 볼 수 있다.

아래는 직접 등록하려는 경우의 수동 절차다. 빌드 후(`npm install`이 자동 빌드) `dist/cli.js`를
진입점으로 쓰며, `<ABS>`는 이 저장소 절대경로.

**③ SessionStart hook (매일 거울)** — `aimm init`이 SessionStart hook도 함께 등록한다(멱등). Claude Code를 열 때마다(startup · resume) `systemMessage`로 어제·이번주(최근7일) 비용-확인 세션 현황을 한 줄 표시한다. content가 있으면 어제 **다룬 영역 share%**를 붙여 날짜를 구별한다. compact·clear 이벤트에는 뜨지 않는다.

```
🪞 어제: 3세션 · $12.40 · TypeScript 60%·문서 25%  |  이번주(최근7일): 15세션 · $378.25
```

> `top-level systemMessage`로 전달해야 Claude Code가 표시한다(중첩 `hookSpecificOutput.systemMessage`는 보이지 않음 — 스파이크 확인 사항).

**`aimm today`** — 세션 밖에서 아무 때나 현황을 조회한다. 오늘(지금까지)은 3축(활동·영역·명령) 풀뷰, 어제는 한 줄, 이번주(최근7일, 오늘 포함)는 요약. claude-only(cost-known).

```
$ aimm today
🪞 오늘(지금까지): 2세션 · $138.54
- 활동: 탐색 38% · 구현 34% · 실행·검증 14% · 계획·조율 13%   (도구 호출 119건 기준)
- 다룬 영역: TypeScript 49 · 문서 22 · 기타 3
- 명령: 버전관리(git 4) · 패키지(npx 4) · 파일(ls·mkdir 3)
어제: 기록 없음
이번주(최근7일): 2세션 · $138.54
```

**① SessionEnd hook (자동 초안)** — `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node <ABS>/dist/cli.js hook" } ] }
    ]
  }
}
```

세션이 끝날 때마다 `~/aimm/draft-<date>.md`에 초안이 생성된다. 실패해도 같은
파일에 에러 노트를 남겨 조용히 죽지 않는다(§4.4).

**② MCP 서버 (`/standup`·`/analyze` 도구)**:

```bash
claude mcp add aimm -- node <ABS>/dist/cli.js mcp
```

또는 `.mcp.json`:

```json
{ "mcpServers": { "aimm": { "command": "node", "args": ["<ABS>/dist/cli.js", "mcp"] } } }
```

등록 후 Claude Code 안에서 standup/analyze 도구를 호출할 수 있다(결정적 결과,
외부 전송 없음).

## 메트릭 상세

Claude Code 세션 JSONL(`~/.claude/projects/<slug>/<uuid>.jsonl`)의 각 assistant
메시지에서 다음을 파생한다(2026-06-10 실측 확인):

- `message.model` — 예: `claude-opus-4-8`
- `message.usage` — `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`
- `timestamp` — ISO 8601 **UTC** (표시·집계 시 KST로 변환)

**추정 비용**은 모델 패밀리별 단가(`src/pricing.ts`, 버전 명시)에 캐시 단가를
반영한다 — `cache_read ≈ 정가의 10%`, `cache_creation ≈ 125%`. 단가 테이블에
없는 모델은 비용 0 + "단가 미상" 플래그로 노출한다. 절대값보다 **상대 비교·추세**
용도다.

## 마스킹 상세

`src/core/mask.ts`는 gitleaks 룰셋에서 채용한 고신호 패턴으로 비밀을 가린다:
AWS 키, GitHub PAT(클래식/fine-grained), OpenAI/Anthropic 키, Google API 키,
Slack 토큰, JWT, Bearer 토큰, private key 블록, 그리고 컨텍스트 할당형
(`api_key = "..."` 등 16자 이상 값).

- **fail-closed** — 엔진이 에러를 내면 부분 결과를 신뢰하지 않고 `MaskerError`를
  던진다. 전송 경계는 이를 받아 LLM 전송을 막는다.
- **가림 가시성** — 몇 개를 어떤 룰로 가렸는지 반환해 승인 화면에 "N개 비밀 가림"으로 보여준다.
- '완벽한 차단'을 주장하지 않는다. 룰셋은 변형된 비밀을 놓칠 수 있고, 전송 전
  사용자 확인과 `.aimm-ignore`(예정)가 함께 방어한다.

적대적 테스트(`test/mask.test.ts`)가 위 형식 전부의 가림과 과잉 마스킹 방지,
fail-closed를 검증한다.

## 일자 귀속 (KST)

타임스탬프는 UTC이므로 KST(UTC+9)로 변환해 일자를 정한다. 세션은 **시작 시각
기준**으로 귀속하며, 자정을 넘는 세션도 시작일에 속한다(`src/core/day.ts`).

## 데이터 경계 & 프라이버시

- **외부로 나가는 것(최소화):** 커밋 메시지·diff 요약·대화 요약 텍스트 — 마스킹 후에만.
- **PC를 떠나지 않는 것:** 원본 JSONL, 전체 diff, 개인 활동 원자료.
- 개인 데이터는 본인 PC에만 저장·본인만 열람. 보고서 제출 여부·내용은 본인이 결정한다.
- 팀 단위 집계·개인별 비교는 PoC 범위에서 제외한다(감시 도구 오인 방지).

## 프로젝트 구조

```
src/
  types.ts            정규화 모델(단일 파싱 패스의 계약)
  pricing.ts          단가 테이블(캐시 반영, 버전 명시)
  parse/
    claudeCode.ts     JSONL 파서(어댑터, 손상 레코드 skip+warn)
    git.ts            git log 파서(순수 함수)
  core/
    metrics.ts        결정적 토큰·비용 집계(LLM 우회)
    day.ts            KST day boundary
    mask.ts           비밀 마스킹(gitleaks 룰셋, fail-closed)
    analysis.ts       개인 사용 분석 롤업(모델 믹스·추세·시간대·프로젝트·내용 요약)
    content.ts        세션 내용 다이제스트 분류·롤업(결정적, 닫힌 어휘)
    summarize.ts      "어제 한 일" 요약 + 마스킹 전송 경계
    render.ts         초안·메트릭·분석 렌더(빈/에러 상태)
    standup.ts        오케스트레이터(CLI/hook/MCP 공유 코어)
    hook.ts           SessionEnd hook 진입(초안을 파일로, 실패 시 에러 노트)
    init.ts           aimm init(hook·MCP 자동 등록, 센티넬 멱등·백업)
  llm/
    summarizer.ts     Summarizer 인터페이스 + 에러(DI)
    anthropic.ts      실제 Anthropic 요약기(haiku, env 키)
  mcp/
    server.ts         MCP 서버(/standup·/analyze 도구)
  fs/
    sessions.ts       세션 JSONL 읽기
    git.ts            git 수집(child_process)
    discover.ts       세션 파일 발견(~/.claude/projects)
  cli.ts              진입점: metrics / standup / analyze / portrait / init / hook / session-start / today / mcp
test/                 29개 파일, 228 테스트
```

## 상태 & 로드맵

**완료:** 파서 · 결정적 메트릭(캐시 반영) · 마스킹(fail-closed, 적대 테스트) ·
KST 일자 · 렌더(빈/에러 상태) · standup 오케스트레이터 · 개인 사용 분석(analyze) ·
LLM 요약/내러티브 + 마스킹 전송 경계(드라이런/--send, 폴백) · 멀티소스 어댑터(Cursor) ·
**세션 내용 요약**(analyze/portrait/narrative에 "무엇을 했나" — 결정적 닫힌-어휘) ·
**진입점(SessionEnd hook · MCP 서버 · `aimm init`)** ·
**SessionStart 거울**(`aimm session-start` — 매일 Claude Code 시작 시 한 줄, 어제 영역 share% 포함) ·
**`aimm today`**(세션 밖 3축 풀뷰) · parse-once 수집(startup 상수화) · CLI. **228 테스트 그린.**

**다음 (마이너):**
- `.aimm-ignore` 파서(민감 저장소 수집 제외), 주제 키워드 추출(마스킹 검토 후)

**단계별 발전 방향:** [ROADMAP.md](./ROADMAP.md) 참고.
Phase 1(단일 LLM 분석 심화) → Phase 2(멀티 LLM, 로컬 로그 우선) →
Phase 3(설치형 프로그램으로 PC 전체 LLM 사용 분석 — 무엇을·언제·어떤 상황에).

**후속(PoC 범위 밖):** 멀티-AI 메트릭(Cursor·ChatGPT·Gemini), 경영 대시보드,
구독 의사결정용 사용·비용 통계(옵트인 익명 집계).

## 어떻게 만들었나 — AI 페어링

이 저장소는 **Claude Code를 페어로 써서** 만들었다. 구현 타이핑·초안은 AI가,
**아키텍처·스코프·트레이드오프 결정은 내가** 했다. 그 과정 자체를 증거로 남긴다:

- **전략/스코프** — [CEO 플랜](docs/superpowers/aimm-ceo-plan.md):
  적대적 리뷰 1라운드를 거친 스코프 결정표(E1~E7)와 영구 제외선(경영진 감시 모드).
- **기능별 설계** — [docs/superpowers/specs/](docs/superpowers/specs/):
  각 기능의 목적·정체성·트레이드오프. 예) E2를 "git 상관"이 아니라
  "내가 어떻게 쓰는지"로 재구성한 판단.
- **구현 계획** — [docs/superpowers/plans/](docs/superpowers/plans/):
  brainstorm → spec → plan → 구현 사이클의 task 단위 분해.

설계 결정의 예 — 모두 위 문서에 근거가 있다: 메트릭은 LLM을 우회해 결정적으로
계산(환각 차단), 마스킹은 fail-closed, "세션 지속(추정)"처럼 한계를 정직하게 표기.

## 개발

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # tsc → dist/
npm run dev -- standup --date 2026-06-09   # tsx로 직접 실행
```

---

사내용(Internal) PoC. 외부 배포 전 사내 AI 사용 정책 부합 확인 필요(기획서 §4.3).
