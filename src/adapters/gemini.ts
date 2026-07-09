/**
 * Gemini (Antigravity IDE) 소스 어댑터 (Phase 2).
 *
 * Google Antigravity(Gemini 기반 IDE)는 세션별 산출물을
 * `~/.gemini/antigravity/brain/<uuid>/*.metadata.json`에 둔다.
 * 실측(2026-07-09): metadata = {artifactType, summary, updatedAt(ISO)}.
 * **토큰·모델·프롬프트 없음, 시각만** → providesCost=false(시간·세션 수만, 가장 얇은 소스).
 *
 * 참고: 진짜 `gemini-cli`(google-gemini/gemini-cli)의 대화·토큰 로그는 이 머신에 없음(하드월).
 * 로그가 생기면 별도 어댑터로 추가한다(이 어댑터는 Antigravity 전용).
 *
 * 견고성(SourceAdapter 계약): 부재/손상 fail-soft, 절대 throw 안 함.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NormalizedMessage, NormalizedSession, ParseResult, ParseWarning } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";

function defaultBrainDir(): string {
  return join(homedir(), ".gemini", "antigravity", "brain");
}

function parseIso(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 한 uuid 세션의 metadata.json들에서 updatedAt 시각을 모아 정규화 세션 1개로. */
async function collectUuidSession(uuidDir: string, uuid: string, warnings: ParseWarning[]): Promise<NormalizedSession | null> {
  let names: string[];
  try {
    names = (await readdir(uuidDir)).filter((n) => n.toLowerCase().endsWith(".metadata.json"));
  } catch {
    return null;
  }
  const messages: NormalizedMessage[] = [];
  for (const name of names) {
    let ts: Date | null = null;
    try {
      const obj: unknown = JSON.parse(await readFile(join(uuidDir, name), "utf-8"));
      if (typeof obj === "object" && obj !== null) ts = parseIso((obj as Record<string, unknown>).updatedAt);
    } catch {
      warnings.push({ line: 0, reason: `Antigravity metadata 파싱 실패 — skip(${uuid}/${name})` });
      continue;
    }
    if (ts) {
      messages.push({ model: "gemini/antigravity", timestamp: ts, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } });
    }
  }
  if (messages.length === 0) return null;
  const times = messages.map((m) => m.timestamp.getTime());
  return {
    sessionId: uuid,
    projectPath: undefined,
    messages,
    startTime: new Date(Math.min(...times)),
    endTime: new Date(Math.max(...times)),
  };
}

export const geminiAdapter: SourceAdapter = {
  id: "gemini-antigravity",
  displayName: "Gemini (Antigravity)",
  providesCost: false, // 시각만 — 토큰·모델·프롬프트 없음(가장 얇은 소스)
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    const brainDir = opts.rootDir ?? defaultBrainDir();
    const warnings: ParseWarning[] = [];
    if (!existsSync(brainDir)) return { sessions: [], warnings };

    let uuids: string[];
    try {
      uuids = (await readdir(brainDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return { sessions: [], warnings };
    }
    const sessions: NormalizedSession[] = [];
    for (const uuid of uuids) {
      const s = await collectUuidSession(join(brainDir, uuid), uuid, warnings);
      if (s) sessions.push(s);
    }
    return { sessions, warnings };
  },
};
