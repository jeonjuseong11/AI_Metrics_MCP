/**
 * Git 수집 — child_process로 git을 호출한다(수집은 로컬에서만).
 * 파싱은 parse/git.ts(순수)에 위임. git 실패는 throw 대신 빈 결과+경고로 격리.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GIT_LOG_FORMAT, parseGitLog, type Commit } from "../parse/git.js";

const execFileAsync = promisify(execFile);

export interface GitCollectResult {
  commits: Commit[];
  warning?: string;
}

/**
 * repoPath에서 [startUtc, endUtc) 구간의 커밋을 수집.
 * author 지정 시 해당 작성자만. 머지 커밋은 제외(--no-merges).
 */
export async function collectCommits(
  repoPath: string,
  startUtc: Date,
  endUtc: Date,
  author?: string,
): Promise<GitCollectResult> {
  const args = [
    "-C",
    repoPath,
    "log",
    "--no-merges",
    `--since=${startUtc.toISOString()}`,
    `--until=${endUtc.toISOString()}`,
    `--pretty=format:${GIT_LOG_FORMAT}`,
  ];
  if (author) args.push(`--author=${author}`);

  try {
    const { stdout } = await execFileAsync("git", args, { maxBuffer: 32 * 1024 * 1024 });
    return { commits: parseGitLog(stdout) };
  } catch (err) {
    return { commits: [], warning: `git 수집 실패(${repoPath}): ${(err as Error).message}` };
  }
}
