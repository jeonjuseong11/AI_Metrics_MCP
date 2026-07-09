/**
 * 회고록 파일 생성 — 주기(주간/월간) 자동화 진입점 (B).
 *
 * `aimm retro --write`가 회고 문서를 ~/aimm/retro-<end>.md로 쓴다. OS 스케줄러
 * (Windows schtasks / cron)가 주 1회 호출하면 주간 회고가 자동 쌓인다.
 *
 * - **결정적 기본:** 스케줄 경로는 LLM/키 없이 렌더(백그라운드에서 비용·전송 0).
 *   situation(무엇을 했나)은 --repo 주면 포함, narrative는 인터랙티브 --send 전용.
 * - **주간 멱등:** 같은 창(end 날짜) 파일이 있으면 재생성 skip(--force로 덮어씀).
 * - **조용히 죽지 않음(§4.4):** 실패 시 같은 파일에 에러 노트를 남긴다.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildAnalysis, ANALYSIS_ADAPTERS, type AnalysisBuildOptions } from "./standup.js";
import { renderAnalysis } from "./render.js";

export interface RetroWriteOptions {
  start: string;
  end: string;
  author?: string;
  repoPath?: string;
  sessionFiles?: string[];
  /** 출력 디렉터리(기본 ~/aimm). 테스트 주입. */
  outDir?: string;
  /** 같은 창 파일이 있어도 덮어씀. */
  force?: boolean;
}

export interface RetroWriteResult {
  path: string;
  /** 실제로 썼는가(멱등 skip이면 false). */
  written: boolean;
  ok: boolean;
}

function defaultOutDir(): string {
  return join(homedir(), "aimm");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runRetroWrite(o: RetroWriteOptions): Promise<RetroWriteResult> {
  const outDir = o.outDir ?? defaultOutDir();
  const path = join(outDir, `retro-${o.end}.md`);

  // 주간 멱등: 같은 창(end)의 회고가 이미 있으면 재생성 안 함.
  if (!o.force && (await exists(path))) {
    return { path, written: false, ok: true };
  }

  let body: string;
  let ok: boolean;
  try {
    const opts: AnalysisBuildOptions = { start: o.start, end: o.end, adapters: ANALYSIS_ADAPTERS };
    if (o.author) opts.author = o.author;
    if (o.repoPath) opts.repoPath = o.repoPath;
    if (o.sessionFiles) opts.sessionFiles = o.sessionFiles;
    const { analysis, narrative, situation } = await buildAnalysis(opts);
    body = renderAnalysis(analysis, o.author, narrative, situation, "AI 회고");
    ok = true;
  } catch (err) {
    // §4.4: 조용히 죽지 않는다 — 에러 노트를 파일에 남긴다.
    body = `# AI 회고 — ${o.start} ~ ${o.end}\n\n> ⚠️ 자동 생성 실패: ${(err as Error).message}\n\n\`aimm retro --write\`를 직접 실행해 확인하세요.\n`;
    ok = false;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path, body, "utf-8");
  return { path, written: true, ok };
}
