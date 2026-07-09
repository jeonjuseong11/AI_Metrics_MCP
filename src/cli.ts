#!/usr/bin/env node
/**
 * AIMM CLI 코어 진입점.
 *
 * 부록 A "A3": 핵심 로직은 이 CLI 코어가 보유하고, hook과 MCP 도구는
 * 같은 코어 함수를 호출하는 얇은 진입점이 된다.
 *
 * 인자 파싱은 의존성 없이 명시적으로(explicit > clever). 지금은 `metrics`만.
 */

import { readSessionFiles } from "./fs/sessions.js";
import { aggregate } from "./core/metrics.js";
import { renderMetricsBlock } from "./core/render.js";
import { buildStandup, buildAnalysis, ANALYSIS_ADAPTERS, type StandupOptions, type AnalysisBuildOptions } from "./core/standup.js";
import { renderAnalysis } from "./core/render.js";
import { renderPortrait, type PortraitOptions } from "./core/portrait.js";
import { toKstDateString, isoDatePlusDays } from "./core/day.js";
import { createAnthropicSummarizer, createAnthropicNarrator, createAnthropicMemoirNarrator, createAnthropicBuiltSummarizer } from "./llm/anthropic.js";
import { discoverSessionFiles } from "./fs/discover.js";
import { collectIntents, prepareIntentSend } from "./core/intent.js";
import { runHook, type HookOptions } from "./core/hook.js";
import { runRetroWrite, type RetroWriteOptions } from "./core/retro.js";
import { runInit, INIT_MODULE_URL, type InitIo } from "./core/init.js";
import { parseSessionSource, shouldMirror, toHookOutput, runSessionStart, runToday, failureGlance, type TodayOptions } from "./core/sessionStart.js";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

function usage(): void {
  process.stderr.write(
    [
      "aimm — AI-Metrics MCP",
      "",
      "Usage:",
      "  aimm metrics <session.jsonl> [...]      세션 로그의 메트릭만 출력",
      "  aimm standup [옵션]                       일일 스크럼 초안 생성",
      "    --date YYYY-MM-DD   대상 KST 날짜(기본: 어제)",
      "    --author <name>     git 작성자 필터 + 초안 헤더",
      "    --repo <path>       커밋을 수집할 저장소 경로",
      "    --sessions <file>   세션 파일 명시(반복 가능; 기본: ~/.claude/projects 자동 발견)",
      "    --llm               LLM 요약 사용. 기본은 드라이(보낼 내용·가림 건수만 출력)",
      "    --send              실제로 LLM에 전송(ANTHROPIC_API_KEY 필요). --llm과 함께",
      "  aimm analyze [옵션]                       개인 AI 사용 분석 문서 생성",
      "    --start YYYY-MM-DD  시작 KST 날짜(기본: 데이터 전체)",
      "    --end YYYY-MM-DD    끝 KST 날짜",
      "    --author <name>     문서 헤더",
      "    --sessions <file>   세션 파일 명시(반복 가능)",
      "    --repo <path>       작업 성격(커밋 타입)을 분류할 저장소 경로",
      "    --llm               주간 사용을 LLM으로 서술. 기본은 드라이(보낼 수치·가림 건수만)",
      "    --send              실제로 LLM에 전송(ANTHROPIC_API_KEY 필요). --llm과 함께",
      "  aimm retro [옵션]                         회고록 = 사용 패턴 + 무엇을 만들었나 한 문서(기간 기본 최근 1주)",
      "    --period week|month  기간 프리셋(--start/--end 없을 때만; 기본 week)",
      "    --write [--force]    회고를 ~/aimm/retro-<end>.md로 저장(주기 자동화용, 주간 멱등)",
      "    --start/--end/--repo/--author/--llm/--send  analyze와 동일",
      "  aimm portrait [옵션]                      공유용 AI craft 초상(텍스트+표) 생성",
      "    --start YYYY-MM-DD  시작 KST 날짜(기본: 데이터 전체)",
      "    --end YYYY-MM-DD    끝 KST 날짜",
      "    --author <name>     문서 헤더",
      "    --sessions <file>   세션 파일 명시(반복 가능)",
      "  aimm hook [옵션]                          초안을 ~/aimm/draft-<date>.md로 생성(SessionEnd hook용)",
      "    --date/--author/--repo  standup과 동일",
      "  aimm session-start                       SessionStart hook용 — 어제·이번주 거울 한 줄(stdin JSON)",
      "  aimm today [--repo <path>] [--sessions <file>]   오늘·어제·이번주 현황(3축). --repo면 오늘 만든 것(커밋)도",
      "  aimm init [--dry-run]                     SessionEnd hook·MCP 자동 등록(원커맨드 셋업)",
      "  aimm mcp                                  MCP stdio 서버 시작(Claude Code가 호출)",
      "",
    ].join("\n"),
  );
}

/** 명령 플래그 파서 — Node stdlib util.parseArgs. 반복 플래그(--sessions)는 배열, 나머지는 값/불린. */
function parseFlags(args: string[]) {
  const { values } = parseArgs({
    args,
    allowPositionals: true, // 비플래그 인자는 무시(관대)
    options: {
      date: { type: "string" },
      author: { type: "string" },
      repo: { type: "string" },
      sessions: { type: "string", multiple: true },
      start: { type: "string" },
      end: { type: "string" },
      period: { type: "string" },
      llm: { type: "boolean" },
      send: { type: "boolean" },
      write: { type: "boolean" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  return values;
}

async function cmdStandup(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: StandupOptions = {};
  if (flags.date) opts.date = flags.date;
  if (flags.author) opts.author = flags.author;
  if (flags.repo) opts.repoPath = flags.repo;
  // --sessions 존재 시(빈 배열이라도) 설정 → 자동 발견 스킵. 부재 시 undefined → 자동 발견.
  const sessions = flags.sessions?.filter((s) => s !== "");
  if (sessions) opts.sessionFiles = sessions;

  const useLlm = flags.llm === true;
  const send = flags.send === true;
  if (useLlm) {
    opts.useLlm = true;
    if (send) opts.summarizer = createAnthropicSummarizer();
    else opts.dryRunLlm = true;
  }

  const result = await buildStandup(opts);
  process.stdout.write(result.draft + "\n");

  if (result.preview) {
    process.stderr.write(
      `\n[dry-run] LLM에 전송될 내용 (${result.preview.redactions.length}개 비밀 가림):\n` +
        "─".repeat(50) +
        "\n" +
        result.preview.maskedContext +
        "\n" +
        "─".repeat(50) +
        "\n실제 전송하려면 --send 를 추가하세요(ANTHROPIC_API_KEY 필요).\n",
    );
  }
  if (result.warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${result.warnings.length}건:\n`);
    for (const w of result.warnings) process.stderr.write(`  - ${w}\n`);
  }
  return 0;
}

async function cmdHook(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: HookOptions = {};
  if (flags.date) opts.date = flags.date;
  if (flags.author) opts.author = flags.author;
  if (flags.repo) opts.repoPath = flags.repo;
  const r = await runHook(opts);
  process.stderr.write(`${r.ok ? "초안 생성됨" : "초안 생성 실패(에러 노트 기록)"}: ${r.path}\n`);
  return r.ok ? 0 : 1;
}

/** stdin 전체를 읽는다(SessionStart hook이 JSON을 stdin으로 넘김). */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

/** SessionStart hook 진입점. 거울 한 줄을 top-level systemMessage로 낸다. 항상 exit 0. */
async function cmdSessionStart(): Promise<number> {
  try {
    const raw = await readStdin();
    const source = parseSessionSource(raw);
    if (!shouldMirror(source)) return 0; // compact·clear·기타 스킵(무출력)
    const line = await runSessionStart();
    process.stdout.write(toHookOutput(line));
  } catch (err) {
    // 절대 세션을 깨지 않는다 — systemMessage로 실패를 알리고 exit 0.
    process.stdout.write(toHookOutput(failureGlance(err)));
  }
  return 0;
}

/** `aimm today` — 세션 밖에서 오늘·어제·이번주 현황(3축 풀뷰)을 stdout으로. --repo 시 오늘 만든 것. claude-only. */
async function cmdToday(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: TodayOptions = {};
  // --sessions 존재 시(빈 배열이라도) 설정 → 자동 발견 스킵. 부재 시 undefined → 자동 발견.
  const sessions = flags.sessions?.filter((s) => s !== "");
  if (sessions) opts.sessionFiles = sessions;
  if (flags.repo) opts.repoPath = flags.repo;
  if (flags.author) opts.author = flags.author;
  const out = await runToday(opts);
  process.stdout.write(out + "\n");
  return 0;
}

async function cmdMcp(): Promise<number> {
  const { startMcpServer } = await import("./mcp/server.js");
  await startMcpServer();
  // stdio 서버는 stdin이 닫힐 때까지 살아있어야 한다 — 의도적으로 resolve하지 않음.
  return new Promise<number>(() => {});
}

/** analyze/retro 공통 몸통 — buildAnalysis + '무엇을 만들었나'(내용) + preview/warnings. heading만 다름. */
async function emitAnalysis(opts: AnalysisBuildOptions, useLlm: boolean, send: boolean, heading: string): Promise<number> {
  opts.adapters = ANALYSIS_ADAPTERS; // 멀티소스(Claude Code + Cursor + Codex)
  const { analysis, warnings, narrative, preview, situation } = await buildAnalysis(opts);
  process.stdout.write(renderAnalysis(analysis, opts.author, narrative, situation, heading) + "\n");

  // 무엇을 만들었나(내용 기반) — --llm 시. 원시 프롬프트+파일 경로 → 마스킹(fail-closed) → LLM 성과 서술.
  // claude 세션 원시 텍스트만 다룸(이 경로에서만). --send 아니면 dry-run으로 보낼 내용만 보여줌.
  if (useLlm) {
    try {
      const files = opts.sessionFiles ?? (await discoverSessionFiles());
      const window: { start?: string; end?: string } = {};
      if (opts.start) window.start = opts.start;
      if (opts.end) window.end = opts.end;
      const { masked, redactions } = prepareIntentSend(await collectIntents(files, window));
      if (masked.trim() !== "") {
        if (send) {
          const built = await createAnthropicBuiltSummarizer()(masked);
          process.stdout.write(`\n## 무엇을 만들었나 — 내용 기반 요약\n\n${built.trim()}\n`);
          if (redactions.length > 0) warnings.push(`무엇을만들었나(내용): ${redactions.length}개 비밀 가림 후 전송`);
        } else {
          process.stderr.write(
            `\n[dry-run] '무엇을 만들었나(내용)' 전송 예정 (${redactions.length}개 비밀 가림):\n` +
              "─".repeat(50) + "\n" + masked + "\n" + "─".repeat(50) +
              "\n실제 전송하려면 --send 를 추가하세요(ANTHROPIC_API_KEY 필요).\n",
          );
        }
      }
    } catch (err) {
      warnings.push(`무엇을만들었나(내용) 생성 실패(마스킹 차단 가능): ${(err as Error).message}`);
    }
  }

  if (preview) {
    process.stderr.write(
      `\n[dry-run] LLM에 전송될 내용 (${preview.redactions.length}개 비밀 가림):\n` +
        "─".repeat(50) +
        "\n" +
        preview.maskedContext +
        "\n" +
        "─".repeat(50) +
        "\n실제 전송하려면 --send 를 추가하세요(ANTHROPIC_API_KEY 필요).\n",
    );
  }
  if (warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${warnings.length}건:\n`);
    for (const w of warnings) process.stderr.write(`  - ${w}\n`);
  }
  return 0;
}

/** 공통: 플래그 → AnalysisBuildOptions + useLlm/send. */
function analyzeOptsFromFlags(flags: ReturnType<typeof parseFlags>): { opts: AnalysisBuildOptions; useLlm: boolean; send: boolean } {
  const opts: AnalysisBuildOptions = {};
  if (flags.start) opts.start = flags.start;
  if (flags.end) opts.end = flags.end;
  const sessions = flags.sessions?.filter((s) => s !== "");
  if (sessions) opts.sessionFiles = sessions;
  if (flags.repo) opts.repoPath = flags.repo;
  if (flags.author) opts.author = flags.author;
  const useLlm = flags.llm === true;
  const send = flags.send === true;
  if (useLlm) {
    opts.useLlm = true;
    if (send) opts.summarizer = createAnthropicNarrator();
    else opts.dryRunLlm = true;
  }
  return { opts, useLlm, send };
}

async function cmdAnalyze(args: string[]): Promise<number> {
  const { opts, useLlm, send } = analyzeOptsFromFlags(parseFlags(args));
  return emitAnalysis(opts, useLlm, send, "AI 사용 분석");
}

/** period(week=최근7일·month=최근30일) → KST 창. 명시 --start/--end가 있으면 그걸 우선. */
function retroWindow(period: string | undefined): { start: string; end: string } {
  const end = toKstDateString(new Date());
  const days = period === "month" ? 29 : 6; // 기본 week
  return { start: isoDatePlusDays(end, -days), end };
}

/** aimm retro — 사용 패턴 + 무엇을 만들었나를 한 회고 문서로. 기간 기본=최근 1주. */
async function cmdRetro(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const { opts, useLlm, send } = analyzeOptsFromFlags(flags);
  // 회고는 주간 요약이 아니라 '한 편의 회고 글' → 내레이터를 memoir 톤으로 교체.
  if (send) opts.summarizer = createAnthropicMemoirNarrator();
  // 기간 미지정 시 회고 창(week/month)을 기본으로 채운다. 명시 --start/--end는 존중.
  if (!opts.start && !opts.end) {
    const w = retroWindow(flags.period);
    opts.start = w.start;
    opts.end = w.end;
  }

  // --write: 회고를 파일로(주기 자동화용, 결정적·주간 멱등). 스케줄러가 호출.
  if (flags.write === true) {
    const w: RetroWriteOptions = { start: opts.start!, end: opts.end! };
    if (opts.author) w.author = opts.author;
    if (opts.repoPath) w.repoPath = opts.repoPath;
    if (opts.sessionFiles) w.sessionFiles = opts.sessionFiles;
    if (flags.force === true) w.force = true;
    const r = await runRetroWrite(w);
    process.stderr.write(
      `${r.written ? (r.ok ? "회고 생성됨" : "회고 생성 실패(에러 노트 기록)") : "이미 있음(skip, --force로 덮어쓰기)"}: ${r.path}\n`,
    );
    return r.ok ? 0 : 1;
  }

  return emitAnalysis(opts, useLlm, send, "AI 회고");
}

async function cmdPortrait(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: AnalysisBuildOptions = {};
  if (flags.start) opts.start = flags.start;
  if (flags.end) opts.end = flags.end;
  // --sessions 존재 시(빈 배열이라도) 설정 → 자동 발견 스킵. 부재 시 undefined → 자동 발견.
  const sessions = flags.sessions?.filter((s) => s !== "");
  if (sessions) opts.sessionFiles = sessions;
  const author = flags.author;

  opts.adapters = ANALYSIS_ADAPTERS; // portrait도 멀티소스(Claude Code + Cursor)
  const { analysis, warnings } = await buildAnalysis(opts);
  const portraitOpts: PortraitOptions = { generatedDate: toKstDateString(new Date()) };
  if (author) portraitOpts.author = author;
  process.stdout.write(renderPortrait(analysis, portraitOpts) + "\n");
  if (warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${warnings.length}건:\n`);
    for (const w of warnings) process.stderr.write(`  - ${w}\n`);
  }
  return 0;
}

/** claude mcp add(user scope) 시도. 성공 true. 부재/실패/타임아웃 false → 호출부가 .mcp.json 폴백. */
function trySpawnClaude(absCliJs: string): boolean {
  try {
    const r = spawnSync("claude", ["mcp", "add", "aimm", "--scope", "user", "--", "node", absCliJs, "mcp"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function cmdInit(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const dryRun = flags["dry-run"] === true;
  const io: InitIo = {
    homedir: () => homedir(),
    cwd: () => process.cwd(),
    now: () => new Date().toISOString().replace(/[:.]/g, "-"),
    readFile: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
    writeFile: (p, c) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, c);
    },
    backup: (p) => {
      const b = `${p}.aimm-bak-${io.now()}`;
      copyFileSync(p, b);
      return b;
    },
    registerMcp: (abs) => trySpawnClaude(abs),
  };

  const r = runInit(io, INIT_MODULE_URL, { dryRun });
  const out: string[] = [];
  out.push(dryRun ? "[dry-run] aimm init — 변경 예정:" : "aimm init 완료:");
  out.push(`  CLI: ${r.cliJs}`);
  out.push(`  SessionEnd hook: ${r.hookAction} → ${r.settingsPath}`);
  out.push(`  SessionStart hook: ${r.sessionStartAction} → ${r.settingsPath}`);
  out.push(`  MCP 등록: ${r.mcpVia === "claude" ? "claude mcp add --scope user" : `.mcp.json (${r.mcpJsonPath})`}`);
  if (r.mcpVia === "mcp.json") {
    out.push(`  ↳ 전역 등록을 원하면: claude mcp add aimm --scope user -- node ${JSON.stringify(r.cliJs)} mcp`);
  }
  for (const w of r.warnings) out.push(`  ⚠️ ${w}`);
  if (r.backups.length > 0) out.push(`  백업: ${r.backups.join(", ")}`);
  if (!dryRun) {
    out.push("  복구: 위 백업을 원위치로 복사 + `claude mcp remove aimm` + .mcp.json의 aimm 항목 제거.");
    out.push("  다음: Claude Code를 재시작하면 SessionEnd 초안·MCP 도구가 활성화됩니다.");
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

async function cmdMetrics(files: string[]): Promise<number> {
  if (files.length === 0) {
    process.stderr.write("metrics: JSONL 파일 경로가 필요합니다.\n");
    return 2;
  }
  const result = await readSessionFiles(files);
  const agg = aggregate(result.sessions);
  process.stdout.write(renderMetricsBlock(agg) + "\n");
  if (result.warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${result.warnings.length}건:\n`);
    for (const w of result.warnings) {
      process.stderr.write(`  - line ${w.line}: ${w.reason}\n`);
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "metrics":
      return cmdMetrics(rest);
    case "standup":
      return cmdStandup(rest);
    case "analyze":
      return cmdAnalyze(rest);
    case "retro":
      return cmdRetro(rest);
    case "portrait":
      return cmdPortrait(rest);
    case "hook":
      return cmdHook(rest);
    case "session-start":
      return cmdSessionStart();
    case "today":
      return cmdToday(rest);
    case "init":
      return cmdInit(rest);
    case "mcp":
      return cmdMcp();
    case undefined:
    case "-h":
    case "--help":
      usage();
      return 0;
    default:
      process.stderr.write(`알 수 없는 명령: ${command}\n\n`);
      usage();
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
