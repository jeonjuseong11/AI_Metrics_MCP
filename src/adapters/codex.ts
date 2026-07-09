/**
 * Codex CLI 소스 어댑터 (Phase 2).
 *
 * Codex는 세션을 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`에 둔다.
 * Cursor와 달리 토큰·모델이 실재하므로 providesCost=true(진짜 도구 간 비용 비교 성립).
 * 발견은 재귀 glob, 파싱은 parse/codex(순수)에 위임. 파일 부재/손상은 조용한 no-op·warning.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseCodexSession } from "../parse/codex.js";
import type { ParseResult, ParseWarning } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";
import { filterRecentByMtime } from "../fs/discover.js";

function defaultSessionsDir(): string {
  return join(homedir(), ".codex", "sessions");
}

/** ~/.codex/sessions 하위 rollout-*.jsonl 재귀 발견. 디렉터리 없으면 []. */
async function discoverCodexFiles(rootDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir, { recursive: true });
  } catch {
    return []; // Codex 미설치 정상
  }
  return entries
    .filter((e) => /rollout-.*\.jsonl$/i.test(e))
    .map((e) => join(rootDir, e));
}

export const codexAdapter: SourceAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  providesCost: true,
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    let files = opts.paths ?? (await discoverCodexFiles(opts.rootDir ?? defaultSessionsDir()));
    if (opts.sinceMtimeMs !== undefined && opts.paths === undefined) {
      files = await filterRecentByMtime(files, opts.sinceMtimeMs);
    }

    const sessions = [];
    const warnings: ParseWarning[] = [];
    for (const f of files) {
      try {
        const text = await readFile(f, "utf-8");
        const { session, warnings: w } = parseCodexSession(text, basename(f).replace(/\.jsonl$/i, ""));
        sessions.push(session);
        warnings.push(...w);
      } catch (err) {
        warnings.push({ line: 0, reason: `codex 파일 읽기 실패(${basename(f)}): ${(err as Error).message}` });
      }
    }
    return { sessions, warnings };
  },
};
