/**
 * Claude Code 소스 어댑터 (E3).
 *
 * 기존 발견(fs/discover)·읽기(fs/sessions)·파싱(parse/claudeCode)을 합성해 SourceAdapter 계약을
 * 만족한다. "명시 경로 > 자동 발견" 정책은 소스-특화이므로 여기(어댑터)에 둔다.
 * 빈 배열 paths([])는 truthy이며 `[] ?? discover()`가 []를 유지하므로 자동 발견을 건너뛴다 —
 * 기존 오케스트레이터 동작과 동일(이 불변식을 .length 가드로 바꾸지 말 것).
 */

import { discoverSessionFiles, filterRecentByMtime } from "../fs/discover.js";
import { readSessionFiles } from "../fs/sessions.js";
import type { ParseResult } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";

export const claudeCodeAdapter: SourceAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  providesCost: true,
  // 인터페이스는 opts?(선택), 구현은 opts = {}(기본값) — 기본값 있는 필수 매개변수는 선택 계약을 구조적으로 만족(의도된 형태).
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    let files = opts.paths ?? (await discoverSessionFiles(opts.rootDir));
    // 명시 paths는 존중(필터 안 함). 자동 발견 시에만 mtime 프리필터로 최근-창 좁힘.
    if (opts.sinceMtimeMs !== undefined && opts.paths === undefined) {
      files = await filterRecentByMtime(files, opts.sinceMtimeMs);
    }
    return readSessionFiles(files);
  },
};
