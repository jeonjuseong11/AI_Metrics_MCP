/**
 * 디스크에서 Claude Code 세션 JSONL을 읽어 정규화한다.
 *
 * 수집은 사용자 PC 안에서만 이루어진다(문서 §4.1). 이 모듈은 파일 I/O만
 * 담당하고, 파싱 로직은 parse/claudeCode.ts(순수 함수)에 위임한다.
 */

import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parseSessionContent } from "../parse/claudeCode.js";
import type { ParseResult } from "../types.js";

/** sessionId를 파일명(확장자 제거)에서 유도. */
function sessionIdFromPath(filePath: string): string {
  return basename(filePath).replace(/\.jsonl$/i, "");
}

/**
 * JSONL 파일 1개를 읽어 정규화. 읽기 실패는 호출부로 throw.
 * projectPath 미지정 시 부모 디렉터리명(프로젝트 슬러그)에서 유도 → 프로젝트별 분석 가능.
 */
export async function readSessionFile(filePath: string, projectPath?: string): Promise<ParseResult> {
  const content = await readFile(filePath, "utf-8");
  const project = projectPath ?? basename(dirname(filePath));
  const { session, warnings } = parseSessionContent(content, sessionIdFromPath(filePath), project);
  return { sessions: [session], warnings };
}

/** 여러 JSONL 파일을 읽어 하나의 ParseResult로 합친다. 개별 파일 실패는 warning으로 격리. */
export async function readSessionFiles(filePaths: string[], projectPath?: string): Promise<ParseResult> {
  const merged: ParseResult = { sessions: [], warnings: [] };
  for (const filePath of filePaths) {
    try {
      const r = await readSessionFile(filePath, projectPath);
      merged.sessions.push(...r.sessions);
      merged.warnings.push(...r.warnings);
    } catch (err) {
      merged.warnings.push({ line: 0, reason: `파일 읽기 실패(${basename(filePath)}): ${(err as Error).message}` });
    }
  }
  return merged;
}
