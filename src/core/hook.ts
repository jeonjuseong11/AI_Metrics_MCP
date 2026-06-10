/**
 * SessionEnd hook 진입 로직 — 초안을 파일로 생성한다(부록 A A2).
 *
 * Claude Code SessionEnd hook이 `aimm hook`을 호출하면, 어제(또는 지정일)
 * 초안을 생성해 ~/aimm/draft-<date>.md에 쓴다.
 *
 * §4.4: 자동 트리거 실패는 "조용히 죽지 않는다". 실패 시 같은 파일에 가시적
 * 에러 노트를 남겨, 사용자가 "도구가 안 도는데 모르고 방치"하는 것을 막는다.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildStandup, type StandupOptions } from "./standup.js";

export interface HookOptions {
  date?: string;
  author?: string;
  repoPath?: string;
  /** 출력 디렉터리(기본: ~/aimm). 테스트용 주입. */
  outDir?: string;
  now?: Date;
  sessionFiles?: string[];
  projectsDir?: string;
}

export interface HookResult {
  path: string;
  ok: boolean;
}

function defaultOutDir(): string {
  return join(homedir(), "aimm");
}

/** hook 진입점: 초안 생성 후 파일로 쓴다. 실패해도 에러 노트를 남긴다. */
export async function runHook(opts: HookOptions = {}): Promise<HookResult> {
  const outDir = opts.outDir ?? defaultOutDir();

  // 날짜는 실패하더라도 파일명을 정하기 위해 먼저 확정.
  let date: string;
  let body: string;
  let ok: boolean;

  try {
    const standupOpts: StandupOptions = {};
    if (opts.date) standupOpts.date = opts.date;
    if (opts.author) standupOpts.author = opts.author;
    if (opts.repoPath) standupOpts.repoPath = opts.repoPath;
    if (opts.now) standupOpts.now = opts.now;
    if (opts.sessionFiles) standupOpts.sessionFiles = opts.sessionFiles;
    if (opts.projectsDir) standupOpts.projectsDir = opts.projectsDir;

    const result = await buildStandup(standupOpts);
    date = result.date;
    body = result.draft;
    ok = true;
  } catch (err) {
    // §4.4: 조용히 죽지 않는다 — 에러 노트를 파일에 남긴다.
    date = opts.date ?? "unknown";
    body = [
      `# 일일 스크럼 — ${date}`,
      "",
      "> ⚠️ AIMM 자동 생성 실패. 도구가 정상 동작하지 않았습니다.",
      `> 원인: ${(err as Error).message}`,
      "",
      "수동으로 작성하거나 `aimm standup`을 직접 실행해 확인하세요.",
    ].join("\n");
    ok = false;
  }

  const path = join(outDir, `draft-${date}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(path, body, "utf-8");
  return { path, ok };
}
