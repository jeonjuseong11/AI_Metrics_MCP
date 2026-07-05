/**
 * Claude Code 세션 로그 파일 발견.
 *
 * 저장 구조(실측): ~/.claude/projects/<project-slug>/<session-uuid>.jsonl
 * 서브에이전트 로그(<dir>/subagents/*.jsonl)는 별도이므로 기본 제외한다.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 기본 projects 디렉터리. */
export function defaultProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * 각 프로젝트 디렉터리 바로 아래의 세션 JSONL 파일 경로 목록.
 * 디렉터리가 없거나 읽기 실패하면 빈 배열(throw 안 함).
 */
export async function discoverSessionFiles(projectsDir = defaultProjectsDir()): Promise<string[]> {
  let projects: string[];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    projects = entries.filter((e) => e.isDirectory()).map((e) => join(projectsDir, e.name));
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const dir of projects) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith(".jsonl")) {
          files.push(join(dir, e.name));
        }
      }
    } catch {
      // 개별 프로젝트 디렉터리 실패는 무시.
    }
  }
  return files;
}

/**
 * mtime ≥ sinceMs 파일만 남기는 성근 프리필터(거울/today의 최근-창 수집).
 * stat 실패한 파일은 **보존**한다 — 드롭하면 조용한 과소집계가 되므로 상한집합 유지가 안전.
 */
export async function filterRecentByMtime(files: string[], sinceMs: number): Promise<string[]> {
  const kept: string[] = [];
  for (const f of files) {
    try {
      const s = await stat(f);
      if (s.mtimeMs >= sinceMs) kept.push(f);
    } catch {
      kept.push(f); // stat 실패 → 보존(과소집계 방지)
    }
  }
  return kept;
}
