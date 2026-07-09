/**
 * Claude Code CLI 경유 요약기 — API 키 대신 **구독**(claude 로그인)을 쓴다.
 *
 * Anthropic SDK(종량제 API 키) 대신 `claude --print`를 자식 프로세스로 호출한다.
 * 사용자의 `claude` CLI가 로그인(구독)돼 있으면 키 없이 산문이 나온다.
 * 미로그인·실패는 SummarizerError → 호출부가 결정적 문서로 폴백(§4.4).
 *
 * 같은 시스템 프롬프트(anthropic.ts)를 재사용해 SDK 경로와 산출물 톤을 맞춘다.
 */

import { spawn } from "node:child_process";
import { SummarizerError, type Summarizer } from "./summarizer.js";
import { SUMMARY_SYSTEM_PROMPT, NARRATIVE_SYSTEM_PROMPT, MEMOIR_SYSTEM_PROMPT, BUILT_SYSTEM_PROMPT } from "./anthropic.js";

/** system + frame(context)를 합친 최종 프롬프트(테스트 용이하게 분리). */
export function buildCliPrompt(system: string, framed: string): string {
  return `${system}\n\n${framed}`;
}

/** `claude --print`에 프롬프트를 stdin으로 넘겨 stdout(산문)을 받는다. */
function runClaudePrint(prompt: string, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["--print"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32", // claude.cmd 해석
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new SummarizerError("timeout", "claude --print 타임아웃"));
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new SummarizerError("transport", `claude 실행 실패(설치·PATH 확인): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code !== 0) {
        return reject(new SummarizerError("transport", `claude --print 실패(exit ${code}): ${err.slice(0, 200)}`));
      }
      if (text === "" || /Not logged in/i.test(text) || /Please run \/login/i.test(text)) {
        return reject(new SummarizerError("no-api-key", "claude 미로그인 — `claude` 로그인(구독) 후 재시도"));
      }
      resolve(text);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function makeCliCaller(system: string, frame: (ctx: string) => string): Summarizer {
  return (maskedContext: string) => runClaudePrint(buildCliPrompt(system, frame(maskedContext)));
}

/** 일일 스크럼 요약기(구독). standup --llm --send --via-claude. */
export function createClaudeCliSummarizer(): Summarizer {
  return makeCliCaller(SUMMARY_SYSTEM_PROMPT, (ctx) => `어제 커밋 목록:\n${ctx}`);
}

/** 주간 사용 내레이터(구독). analyze --llm --send --via-claude. */
export function createClaudeCliNarrator(): Summarizer {
  return makeCliCaller(NARRATIVE_SYSTEM_PROMPT, (ctx) => `사용 통계(사실 블록):\n${ctx}`);
}

/** 회고 memoir 내레이터(구독). retro --llm --send --via-claude. */
export function createClaudeCliMemoirNarrator(): Summarizer {
  return makeCliCaller(MEMOIR_SYSTEM_PROMPT, (ctx) => `이 기간 사실 블록:\n${ctx}`);
}

/** "무엇을 만들었나" 내용 요약기(구독). */
export function createClaudeCliBuiltSummarizer(): Summarizer {
  return makeCliCaller(BUILT_SYSTEM_PROMPT, (ctx) => `이 기간 요청·파일:\n${ctx}`);
}
