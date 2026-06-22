# 세션 내용 요약 + 클린 설치/aimm init (v0.6.0) — 설계

작성일: 2026-06-22 · 단계: Phase 1 심화("무엇을 했나"를 세션 내용에서) + 배포성(설치 하드닝) · 선행: v0.5.0(E5 Cursor·멀티소스) 완료 · 적대적 spec 리뷰 1라운드 반영(blocker 5건)

기획 배경: [AIMM_PoC_기획서_v2.md](../../../AIMM_PoC_기획서_v2.md) · 로드맵: [ROADMAP.md](../../../ROADMAP.md) · 선행 설계: [situation-signal-design.md](./situation-signal-design.md) · [weekly-narrative-design.md](./weekly-narrative-design.md)

## 목표

두 갈래를 한 버전에 묶는다(독립적이라 충돌 없음).

1. **세션 내용 요약** — 파서가 지금 버리는 `message.content`(tool_use·user 프롬프트)를 스캔해, "이 기간에 무엇을 했나"(활동 믹스·다룬 영역·명령 카테고리·대화 깊이)를 **결정적으로** 분석 보고서(analyze/portrait/narrative)에 넣는다. 현재 "무엇을 했나"는 git 커밋(situation)에서만 와서 **커밋 없는 세션(리서치·디버깅·설계)은 안 보인다** — 그 공백을 세션 자체에서 메운다.
2. **클린 설치 + `aimm init`** — GitHub 클론만으로 MCP 설치가 끝까지 동작하게. 현재 `dist/`가 gitignore인데 `bin`이 `./dist/cli.js`를 가리키고 `prepare` 훅이 없어, 클론 후 `npm install`만으로는 `dist/cli.js`가 없어 `claude mcp add … node <ABS>/dist/cli.js mcp`가 실패한다. 이 핵심 버그를 없애고, `aimm init`으로 hook·MCP 자동 등록까지 원커맨드로.

## 확정된 결정 (브레인스토밍 + 적대 리뷰)

1. **접근 A = 결정적 구조 다이제스트(닫힌 어휘 카운트만).** 다이제스트는 **닫힌·유계 어휘로 분류된 카운트만** 보관한다: 도구명(Claude Code 도구 레지스트리), 알려진 파일 확장자, **허용목록 명령 동사**(미지·경로형은 `기타`). **원시 대화 텍스트·파일 경로·명령 문자열은 분류 후 버려지고 파서를 절대 떠나지 않는다.** 주제(subject) 키워드 추출은 자유텍스트·portrait 누출 위험으로 **v0.6.0 보류**.
2. **추출은 파서 루프를 재구성한다(같은 파일·같은 파일 패스, 같은 줄 루프 — 단, 가드 위로 hoist).** 현재 파서는 `role!=="assistant"`·`usage===undefined`에서 조기 `continue`라 user 프롬프트·usage 없는 tool_use에 **도달 못 한다**. 내용 추출은 이 가드 **위로** 올려 모든 레코드(user·assistant)에서 수행하고, 메트릭(usage) 분기는 **거동 불변**으로 유지한다.
3. **내용 분석 = Claude Code 단독, 격리는 이중.** Cursor 등 cost-unknown은 내용을 신뢰 제공 못 함 → analyze가 **cost-known 세션만** content 롤업에 먹인다(분류 격리). 미래에 cost-unknown 어댑터가 `.content`를 채워도 새지 않도록 호출부에서 명시 필터.
4. **서브에이전트 로그 제외 유지 + 정직한 비대칭 표기.** `discover`는 `subagents/*.jsonl` 제외 → 메인 세션의 *디스패치*(Task/Agent/Skill)는 세지만 서브에이전트 *내부 작업*은 제외 → 무거운 서브에이전트 사용은 총량을 **과소 보고**함을 ℹ️에 명시.
5. **`aimm init`은 실제 수행 + 안전 기본값.** settings.json **안정 센티넬 기반 멱등** 병합 + 타임스탬프 백업, 우리 키만 딥머지, 스폰은 `stdin:ignore`+타임아웃 강제종료, `--dry-run` 미리보기, 복구 절차를 복붙 가능하게 출력, 크로스플랫폼.

## 변하지 않는 원칙 (이 기능에 적용)

- **서술이지 평가가 아님.** tool_use 빈도는 "이런 성격의 작업을 했다"이지 "잘했다"가 아니다. 양이지 실력이 아니다.
- **정직한 한계 표기.** tool_use는 *AI가 수행한 작업*의 근사. Claude Code 단독. 서브에이전트 내부 작업 제외(비대칭). 셋 다 명시.
- **결정적 (LLM 우회).** 다이제스트·롤업은 로컬 결정적(정렬 동률은 코드유닛 비교, localeCompare/Math.random 금지). 산문(--send)은 카테고리를 *서술*할 뿐.
- **로컬 우선 / 프라이버시 (구성상 보장).** 다이제스트 키는 **닫힌 어휘**(도구명·알려진 확장자·허용목록 동사∪기타) — 원시 경로·토큰을 *데이터 구조 차원에서* 보관하지 않는다. narrative 사실줄은 카테고리·정수만이라 **구성상 이미 클린**이고, maskSecrets 통과는 *심층 방어*(주 보장 아님).
- **무오염.** metrics·standup·hook·Cursor 출력 불변(content-unknown 격리 회귀 테스트로 단언).

---

# Part 1 — 세션 내용 요약

## 데이터 흐름

```
parseSessionContent(content, id, project)   ── 루프 재구성(가드 위로 hoist) ──
  for each record:
    JSON 파싱(실패→warn+skip); message 객체 아니면 skip
    ┌─ [내용 추출 — role/usage 가드 '위', 모든 레코드]
    │    assistant content[]:  tool_use.name → 도구 카운트
    │                          tool_use.input.file_path/notebook_path 확장자(알려진) → 영역 카운트, 미지→기타
    │                          Bash/PowerShell input.command 첫 의미 토큰: 허용목록이면 동사, 아니면 기타
    │    user content:         비빈 문자열 또는 text item 포함 → userPrompts++   (tool_result만이면 제외)
    │    → 세션 digest 맵에 누적(닫힌 어휘만 저장)
    └─ [메트릭 — 기존 그대로, 거동 불변]
         role!=="assistant" → (메트릭) continue;  usage===undefined → continue;
         extractTokens … messages.push
  세션 종료: digest에 신호가 하나라도 있으면 NormalizedSession.content 부여(없으면 속성 자체 생략)
        │
 analyze(sessions, opts, sourceMeta)
   └ cost-known(=Claude Code) 세션의 .content만 모음 → summarizeContent() (core/content.ts)
        → UsageAnalysis.contentSummary?: ContentSummary
              ├─▶ renderAnalysis  "## 무엇을 했나 (세션 내용 기반)"   (상세, 항상 결정적)
              ├─▶ renderPortrait  "## 무엇에 썼나"                     (추상화·경로/프로젝트명/카운트/기타-예시 無)
              └─▶ buildNarrativeContext  "[작업내용] …" 사실줄          (카테고리·정수만; 마스킹 통과; --send 시만 산문)
```

- **루프 재구성이 핵심**: 가드를 위로 올리지 않으면 userPrompts는 항상 0, usage 없는 assistant의 tool_use는 0이 된다(리뷰 blocker). 메트릭 `messages.push` 경로는 usage 가드 뒤에 그대로 둬 **거동 바이트 동일**.
- Cursor 세션은 `.content` 없음 + cost-unknown → 롤업 이중 제외 → 내용-미파악 격리.
- `contentSummary`는 `UsageAnalysis`에 **옵셔널**. `sessionsWithContent === 0`이면 섹션·사실줄 생략.

## 파일 / 컴포넌트

### 신규
- `src/core/content.ts` — 순수·결정적.
  - `summarizeContent(digests: SessionContentDigest[]): ContentSummary` — 닫힌 어휘 카운트를 카테고리로 합산·정렬.
  - 분류 테이블(도구→활동, 확장자→영역, 동사→명령 카테고리) + `isKnownExt`/`isKnownVerb`/`classifyVerb` 등 **파서가 공유하는 분류 헬퍼**(닫힌 어휘 단일 출처).
  - `ContentSummary { sessionsWithContent; userPrompts; totalToolUses; activity:[{category,count,share}]; areas:[{area,count}]; commands:[{category,count,exampleVerbs:string[]}] }` — `exampleVerbs`는 허용목록 동사만(기타 예시 없음).
- `test/content.test.ts`.

### 수정
- `src/types.ts` — `SessionContentDigest { userPrompts:number; toolUses:Record<string,number>; fileExts:Record<string,number>; commandVerbs:Record<string,number> }` 추가(주석: **키는 닫힌 어휘** — 도구 레지스트리명 / 알려진 확장자 / 허용목록 동사∪`기타`. 원시 경로·토큰 금지). `NormalizedSession`에 `content?: SessionContentDigest`.
- `src/parse/claudeCode.ts` — 루프 재구성(위 데이터 흐름). 순수 헬퍼 `accumulateContent(digestMaps, message)`로 분리(단위 테스트). **신호 없으면 `content` 속성 생략**(조건부 spread — `exactOptionalPropertyTypes:true`라 `content: undefined` 대입은 타입에러).
- `src/core/analysis.ts` — `UsageAnalysis.contentSummary?`. analyze가 **knownSessions**(cost-known)의 `.content`만 모아 `summarizeContent` 호출(맵 없으면 단일소스=cost-known 기존 동작). cost-unknown은 명시 제외.
- `src/core/render.ts` — `renderAnalysis`에 `## 무엇을 했나` 섹션(`contentSummary?.sessionsWithContent>0`일 때만). 명령 예시 토큰은 `exampleVerbs`(허용목록)만, `기타`는 카운트만.
- `src/core/portrait.ts` — `## 무엇에 썼나` 추상화 섹션. **경로·프로젝트명·카운트·기타-예시·`/`·`\` 절대 비노출** — 활동 카테고리 라벨 + 상위 영역 라벨만.
- `src/core/narrative.ts` — `buildNarrativeContext`가 `a.contentSummary` 있으면 `[작업내용] …` 줄 추가(시그니처 무변경; 이미 `a` 전체 수신).
- `src/llm/anthropic.ts` — `NARRATIVE_SYSTEM_PROMPT`에 한 줄: 작업내용 카테고리를 *근사*로 서술, 정확한 분해·인과 단정 금지.

설계 메모: 분류·롤업은 `content.ts`, 추출은 `parse`. metrics.ts 무변경. MCP `analyze`는 `renderAnalysis(analysis, author)` 그대로 → **전송 없이** 내용 섹션 포함(요청 "보고서에 포함"을 MCP 층에서 충족).

## 추출 규칙 (parse/claudeCode.ts — 가드 위에서, 닫힌 어휘로 저장)

- **toolUses**: assistant `content[]`의 `{type:"tool_use", name}` → `toolUses[name]++`. (도구명은 Claude Code 레지스트리 = 닫힌·비민감. usage 유무와 무관하게 스캔 — 미래에 content/usage가 분리 레코드여도 누락 없게.)
- **fileExts**: 위 tool_use `input.file_path`/`input.notebook_path`에서 `/\.[A-Za-z0-9]{1,12}$/` 매치(소문자) → **`isKnownExt`면 그 확장자 키, 아니면 `기타`**. 정규식상 알파넘 접미사만 → 경로·파일명 본문 저장 불가. (Grep/Glob `path`/`pattern`은 편집 아님 → 제외.)
- **commandVerbs**: `name∈{Bash,PowerShell}`의 `input.command`를 `&&`·`;`로 분절, 각 첫 토큰에서 내비 노이즈 `{cd,pushd,popd,set,export,sudo,env}` 스킵 → 첫 의미 토큰. **`isKnownVerb`(허용목록)면 그 동사 키, 아니면(미지·`/`·`\` 포함 등) `기타`.** → 원시 경로/스크립트명은 절대 키가 되지 않음.
- **userPrompts**: `role==="user"` & (비빈 문자열 content || 배열에 `type==="text"` 존재) → `++`. (`tool_result`만이면 제외.) `thinking`만 든 assistant·빈 content 배열은 기여 0(정상).
- **다중 타깃 도구(MultiEdit 등)**: tool_use는 **1 호출**로 카운트(활동=호출 수 의미), file_path가 여럿이면 각 확장자 카운트(영역=타깃 수, 더 정직). 단일 `file_path`만 있는 현 포맷에선 동일.
- 손상·예상외 형태 → 조용히 스킵(메트릭 영향 0). 절대 throw 안 함.

## 분류 규칙 (core/content.ts — 파서와 공유)

**도구 → 활동:** 구현(`Edit,Write,MultiEdit,NotebookEdit`) · 탐색(`Read,Grep,Glob,LS,NotebookRead,ToolSearch`) · 실행·검증(`Bash,PowerShell,BashOutput,KillShell`) · 계획·조율(`TodoWrite,TaskCreate,TaskUpdate,TaskList,TaskGet,AskUserQuestion,Skill,Agent,Workflow,ExitPlanMode,EnterPlanMode`) · 웹(`WebFetch,WebSearch`) · 그 외→`기타`. (활동 share = 카테고리 count / totalToolUses.)

**알려진 확장자 → 영역:** TypeScript(`.ts .tsx .mts .cts`) · JavaScript(`.js .jsx .mjs .cjs`) · Java(`.java`) · Python(`.py`) · Go(`.go`) · Rust(`.rs`) · 문서(`.md .mdx .txt .rst`) · 설정(`.json .yml .yaml .toml .properties .xml .ini`) · 스타일(`.css .scss .sass .less`) · 셸(`.sh .bash .ps1`) · HTML(`.html`) · SQL(`.sql`). 이 집합 외 확장자·확장자 없는 파일(`Dockerfile` 등)·`.env.local`류는 파서에서 `기타`. (영역 = count 내림차순 상위 N + "외 N개".)

**허용목록 동사(→ 명령 카테고리):** 버전관리(`git gh`) · 패키지(`npm pnpm yarn npx bun pip poetry cargo mvn gradle`) · 실행·테스트(`node tsx ts-node vitest jest pytest deno python java`) · 파일(`ls cat find rm mkdir cp mv touch echo pwd head tail grep sed awk`) · 네트워크(`curl wget`). 그 외 전부 `기타`.

## 렌더 + 사실 블록

**analyze (상세, 결정적):**
```
## 무엇을 했나 (세션 내용 기반)
- 활동: 구현 49% · 탐색 28% · 실행·검증 23%   (도구 호출 1,800건 기준)
- 다룬 영역: TypeScript 508 · 문서 240 · Java 187 · 설정 166
- 명령: 패키지(npm·pnpm·npx 83) · 파일(ls·find·cat 53) · 버전관리(git 25) · 기타 12
- 대화 깊이: 사용자 요청 ~278건 · 내용 분석된 세션 8건
ℹ️ tool_use 빈도 기반 휴리스틱(무엇을 했나의 근사). Claude Code 세션만 분석(타 소스 내용 미파악).
   메인 세션의 서브에이전트 *디스패치*만 셈 — 서브에이전트 내부 작업은 제외(무거우면 총량 과소).
```
- 명령 예시 동사는 허용목록만, `기타`는 카운트만(예시 토큰 없음). 내용 섹션에 `/`·`\` 절대 없음(테스트 단언).

**portrait (추상화, 공유 안전):**
```
## 무엇에 썼나
주로 **구현 중심**(Edit·Write), 그다음 탐색·검증. TypeScript·Java·문서 영역에 사용.
> tool_use 빈도 기반 *서술*이지 평가가 아닙니다.
```

**narrative 사실줄(--send, 카테고리·정수만 → 마스킹은 심층방어):**
```
[작업내용] 활동 구현49%·탐색28%·검증23% · 영역 TS·Java·docs · 명령 패키지·파일·버전관리 · 요청 278건
```

## 에러 처리 / 폴백
- content 신호 0 → 세션 `.content` 생략 → `sessionsWithContent` 미가산 → 섹션·사실줄 생략(기존 출력 그대로).
- content 추출 중 형태 이상 → 항목 스킵(메트릭 영향 0). 파서 abort 안 함.
- Cursor만 활동 → contentSummary 비어 있음 → 내용 섹션 생략, 도구별 표 유지.

---

# Part 2 — 클린 설치 + aimm init

> 구현 순서: **설치 하드닝(순수 버그픽스)을 첫 커밋**으로 분리(누구나 즉시 클론-설치 가능). 그다음 내용 요약, 그다음 `aimm init`. (적대 리뷰의 분리 권고를 버전 분할 대신 커밋 시퀀싱으로 수용 — 사용자 선택대로 v0.6.0에 묶음.)

## 설치 하드닝
- **`package.json`**: `"prepare": "npm run build"` 추가 → 클론 후 `npm install`(및 git-dependency 설치)이 자동 `dist/` 빌드. git-dependency 설치 시 소비자 `node_modules`에서 devDeps(typescript) 설치 후 prepare 실행되므로 tsc 가용(정상). `engines.node` `>=22` 유지(검증: node:sqlite는 cursor.ts `import type`+런타임 try/catch라 구 노드여도 빌드·MCP 무영향, Cursor만 fail-soft; 개발기 Node 24에서 flagless 확인). **npm publish는 범위 밖**(필요 시 `files`/`prepublishOnly` 후속).
- **README**: 설치를 클론→`npm install`(자동 빌드)→`node dist/cli.js init` 흐름으로 정리.
- **검증**: 빈 임시 디렉터리로 현재 트리 클론/복사 → `npm install` → `dist/cli.js` 존재 + `node dist/cli.js --help` 정상 종료를 **실제 확인**.

## aimm init
- **신규** `src/core/init.ts` + `cmdInit`(cli.ts) + usage.
- 동작(`aimm init [--dry-run]`):
  1. `cliJsAbsPath` = `fileURLToPath(import.meta.url)` 기준 형제 `cli.js` 해석. **dist 실행 강제**(argv[1]이 `src/`·`.ts`면 경고: 빌드 후 실행하라).
  2. **SessionEnd hook 병합** — `~/.claude/settings.json` 읽기(없으면 `{}`). 우리 hook 커맨드에 **안정 센티넬**(`aimm hook` 고정 토큰) 포함. `hooks.SessionEnd` 중 그 센티넬 가진 항목이 있으면 **경로가 달라도 그 항목을 교체**(append 아님 → 재클론/이동 시 중복 방지). 없으면 추가. win32 경로 정규화(드라이브 소문자·구분자 통일) 후 비교. 쓰기 전 타임스탬프 백업(`settings.json.aimm-bak-<ts>`), 우리 키만 딥머지.
  3. **MCP 등록** — `claude` PATH면 `claude mcp add aimm --scope user -- node <abs> mcp` 스폰(**stdin:ignore**, 하드 타임아웃 시 자식 강제종료). 비0/타임아웃/부재 → **폴백**: cwd `.mcp.json`에 `mcpServers.aimm` 멱등 병합 + 정확한 명령 출력.
  4. **요약 출력** — 변경 내역 / 백업 경로 / **복붙 가능한 복구 절차**(백업 복원 + `claude mcp remove aimm` + `.mcp.json` 항목 제거) / 다음 단계(재시작).
  - `--dry-run`: 계획만 출력, 쓰기·스폰 없음.
- **안전**: 백업 + 센티넬 멱등(교체) + 딥머지(우리 키만) + 절대경로 + stdin:ignore+타임아웃 + 크로스플랫폼. claude 스포너는 DI 주입(테스트 바이너리 비의존).

## 파일 / 컴포넌트 (Part 2)
### 신규
- `src/core/init.ts` — `planInit(opts,io): InitPlan`(순수: 현재 설정+절대경로→계획) / `applyInit(plan,io)`(백업·쓰기·스폰). 순수 헬퍼 `mergeSessionEndHook(settings, cmd, sentinel)`(센티넬 교체)·`mergeMcpJson(json, entry)`·`normalizeWinPath`.
- `test/init.test.ts`.
### 수정
- `src/cli.ts` — `init` + `--dry-run` + usage.
- `README.md` — 설치 + `aimm init`.

## 테스트 전략 (TDD)
`test/content.test.ts`: 도구→활동 / 확장자→영역(`.env.local`·`Dockerfile`·`.gitignore`→기타, 본문 미보관) / 동사→명령(`./deploy.sh`·`/home/x/run.sh`·미지 동사 → **기타**, 원시 토큰 키 부재 단언) / share·정렬 / 빈·작은 n.
`test/parse.test.ts`(증분): tool_use·user 프롬프트 픽스처 → digest 카운트 정확; **기존 `role:user, content:"hi"` 라인이 이제 userPrompts:1 기여하되 messages=1·warnings=0 불변** 단언; **usage 없는 assistant의 tool_use도 카운트** 픽스처; usage-only 라인은 `content` 생략.
`test/analysis.test.ts`(증분): cost-known digest 합산 → `contentSummary`; **cost-unknown 세션에 합성 `.content`를 넣어도 내용 롤업에서 제외**(격리 회귀).
`test/render.test.ts`·`test/portrait.test.ts`: 섹션 유무 / 명령 예시는 허용목록만·`기타` 예시 없음 / **내용 섹션·portrait에 `/`·`\`·프로젝트명 부재** 단언.
`test/narrative.test.ts`(증분): `[작업내용]` 줄 포함/미포함, `/`·경로·원시토큰 부재, 마스킹 통과.
`test/init.test.ts`: 신규생성 / 센티넬 멱등(경로 바뀌어도 교체·중복 0) / 기존 hook 보존 / 백업 / dry-run 무쓰기 / `.mcp.json` 폴백 / 가짜 claude 스포너(타임아웃·비0 → 폴백).
**기존 146 테스트**는 옵셔널/생략 content라 전부 통과 유지. 목표 ~+22.

## 적대 리뷰 반영 (blocker)
1. **루프 재구성**: 내용 추출을 role/usage 가드 위로 hoist(아니면 userPrompts=0·tool_use 누락). 메트릭 경로 거동 불변.
2. **commandVerbs 누출 차단**: 원시 첫 토큰(경로/스크립트명 가능) 저장 금지 → 허용목록 동사∪`기타`로 닫힌 어휘 저장. fileExts도 알려진 확장자∪`기타`.
3. **렌더 예시 안전**: 예시 동사는 허용목록만, `기타`는 카운트만. 내용 섹션·portrait에 `/`·`\` 부재 단언.
4. **exactOptionalPropertyTypes**: 신호 없을 때 `content` 속성 *생략*(=undefined 대입 금지).
5. **init 멱등 = 안정 센티넬**: 볼라타일 절대경로가 아닌 고정 센티넬로 dedupe·교체, win32 경로 정규화, 스폰 stdin:ignore+타임아웃 강제종료, 복구 절차 복붙 가능.

## 비목표 (이번 버전 제외)
- 주제 키워드(자유텍스트) 추출 · Cursor/타 소스 내용 분석 · 서브에이전트 내부 작업 합산 · standup에 세션 내용 결합(토큰중심·claude-only 유지) · E4 통합뷰·설득문서·Codex/Gemini 소스 · npm publish · `aimm uninstall` 서브커맨드(복구는 출력 안내로 충분).
