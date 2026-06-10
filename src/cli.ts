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
import { buildStandup, buildAnalysis, type StandupOptions, type AnalysisBuildOptions } from "./core/standup.js";
import { renderAnalysis } from "./core/render.js";
import { createAnthropicSummarizer } from "./llm/anthropic.js";
import { runHook, type HookOptions } from "./core/hook.js";

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
      "  aimm hook [옵션]                          초안을 ~/aimm/draft-<date>.md로 생성(SessionEnd hook용)",
      "    --date/--author/--repo  standup과 동일",
      "  aimm mcp                                  MCP stdio 서버 시작(Claude Code가 호출)",
      "",
    ].join("\n"),
  );
}

/** 아주 작은 플래그 파서(반복 플래그는 배열). 의존성 없이 명시적으로. */
function parseFlags(args: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a !== undefined && a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        (out[key] ??= []).push(val);
        i++;
      } else {
        (out[key] ??= []).push("");
      }
    }
  }
  return out;
}

async function cmdStandup(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: StandupOptions = {};
  if (flags.date?.[0]) opts.date = flags.date[0];
  if (flags.author?.[0]) opts.author = flags.author[0];
  if (flags.repo?.[0]) opts.repoPath = flags.repo[0];
  if (flags.sessions && flags.sessions.length > 0) opts.sessionFiles = flags.sessions.filter((s) => s !== "");

  const useLlm = flags.llm !== undefined;
  const send = flags.send !== undefined;
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
  if (flags.date?.[0]) opts.date = flags.date[0];
  if (flags.author?.[0]) opts.author = flags.author[0];
  if (flags.repo?.[0]) opts.repoPath = flags.repo[0];
  const r = await runHook(opts);
  process.stderr.write(`${r.ok ? "초안 생성됨" : "초안 생성 실패(에러 노트 기록)"}: ${r.path}\n`);
  return r.ok ? 0 : 1;
}

async function cmdMcp(): Promise<number> {
  const { startMcpServer } = await import("./mcp/server.js");
  await startMcpServer();
  // stdio 서버는 stdin이 닫힐 때까지 살아있어야 한다 — 의도적으로 resolve하지 않음.
  return new Promise<number>(() => {});
}

async function cmdAnalyze(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: AnalysisBuildOptions = {};
  if (flags.start?.[0]) opts.start = flags.start[0];
  if (flags.end?.[0]) opts.end = flags.end[0];
  if (flags.sessions && flags.sessions.length > 0) opts.sessionFiles = flags.sessions.filter((s) => s !== "");
  const author = flags.author?.[0];

  const { analysis, warnings } = await buildAnalysis(opts);
  process.stdout.write(renderAnalysis(analysis, author) + "\n");
  if (warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${warnings.length}건\n`);
  }
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
    case "hook":
      return cmdHook(rest);
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
