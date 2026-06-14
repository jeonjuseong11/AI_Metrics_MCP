/**
 * 스크럼 초안 오케스트레이터 — CLI/hook/MCP가 공유하는 코어 함수(부록 A A3).
 *
 *   세션 발견·수집 ─┐
 *                   ├─ KST 일자 필터 ─ 메트릭 집계 ─┐
 *   git 수집 ───────┘                                ├─ 렌더 ─ 초안
 *                     (커밋 KST 일자 필터) ──────────┘
 *
 * LLM 요약은 아직 미연동(다음 슬라이스). 현재는 원시 커밋 목록 + 결정적 메트릭으로
 * 초안을 만든다 = §4.4의 LLM-실패 폴백과 동일한 안전 경로.
 */

import { aggregate } from "./metrics.js";
import { analyze, type AnalyzeOptions, type UsageAnalysis } from "./analysis.js";
import { commitsOnKstDay, kstDayRange, sessionsOnKstDay, yesterdayKst } from "./day.js";
import { renderDraft, type DraftOptions } from "./render.js";
import { prepareSend, summarizeAccomplishments } from "./summarize.js";
import { prepareNarrativeSend, narrateUsage } from "./narrative.js";
import type { Redaction } from "./mask.js";
import { collectCommits } from "../fs/git.js";
import { discoverSessionFiles } from "../fs/discover.js";
import { readSessionFiles } from "../fs/sessions.js";
import type { Commit } from "../parse/git.js";
import type { Summarizer } from "../llm/summarizer.js";
import type { ParseWarning } from "../types.js";

export interface StandupOptions {
  /** KST 날짜 "YYYY-MM-DD". 없으면 now 기준 어제. */
  date?: string;
  author?: string;
  /** git 커밋을 수집할 저장소 경로. 없으면 커밋 생략. */
  repoPath?: string;
  /** 명시 세션 파일. 없으면 projectsDir에서 발견. */
  sessionFiles?: string[];
  projectsDir?: string;
  /** 테스트용 고정 시각. */
  now?: Date;
  /** 주어지고 useLlm=true면 "어제 한 일"을 LLM으로 요약(실패 시 커밋 목록 폴백). */
  summarizer?: Summarizer;
  useLlm?: boolean;
  /** useLlm이면서 dryRunLlm=true면 전송하지 않고 "보낼 내용"만 준비(승인용 미리보기). */
  dryRunLlm?: boolean;
}

export interface StandupResult {
  date: string;
  draft: string;
  warnings: string[];
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
}

export async function buildStandup(opts: StandupOptions = {}): Promise<StandupResult> {
  const now = opts.now ?? new Date();
  const date = opts.date ?? yesterdayKst(now);
  const warnings: string[] = [];

  // 1. 세션 수집 → KST 일자 필터 → 메트릭.
  const files = opts.sessionFiles ?? (await discoverSessionFiles(opts.projectsDir));
  const parsed = await readSessionFiles(files);
  for (const w of parsed.warnings) warnings.push(formatParseWarning(w));
  const daySessions = sessionsOnKstDay(parsed.sessions, date);
  const metrics = aggregate(daySessions);

  // 2. git 커밋 수집(선택) → KST 일자 필터(이중 안전).
  let commits: Commit[] = [];
  if (opts.repoPath) {
    const { startUtc, endUtc } = kstDayRange(date);
    const r = await collectCommits(opts.repoPath, startUtc, endUtc, opts.author);
    if (r.warning) warnings.push(r.warning);
    commits = commitsOnKstDay(r.commits, date);
  }

  // 3. LLM 요약(선택). 실패하면 커밋 목록으로 폴백(§4.4).
  const draftOpts: DraftOptions = { date };
  if (opts.author) draftOpts.author = opts.author;
  let preview: StandupResult["preview"];

  if (opts.useLlm && commits.length > 0) {
    if (opts.dryRunLlm) {
      // 전송하지 않고 "보낼 내용"만 준비(마스킹 fail-closed). 승인용 미리보기.
      try {
        preview = prepareSend(commits);
      } catch (err) {
        warnings.push(`전송 준비 실패(마스킹 차단): ${(err as Error).message}`);
      }
    } else if (opts.summarizer) {
      try {
        const { prose, redactions } = await summarizeAccomplishments(commits, opts.summarizer);
        draftOpts.accomplishments = prose;
        if (redactions.length > 0) warnings.push(`마스킹: ${redactions.length}개 비밀 가림 후 전송`);
      } catch (err) {
        draftOpts.generationFailed = true;
        warnings.push(`LLM 요약 실패 — 커밋 목록으로 폴백: ${(err as Error).message}`);
      }
    }
  }

  // 4. 렌더.
  const draft = renderDraft(commits, metrics, draftOpts);
  const result: StandupResult = { date, draft, warnings };
  if (preview) result.preview = preview;
  return result;
}

function formatParseWarning(w: ParseWarning): string {
  return w.line > 0 ? `parse line ${w.line}: ${w.reason}` : w.reason;
}

export interface AnalysisBuildOptions {
  /** KST 시작/끝 날짜(포함). 미지정 시 데이터 전체. */
  start?: string;
  end?: string;
  sessionFiles?: string[];
  projectsDir?: string;
  /** 주어지고 useLlm=true면 주간 사용을 LLM으로 서술(실패 시 결정적 문서로 폴백). */
  summarizer?: Summarizer;
  useLlm?: boolean;
  /** useLlm이면서 dryRunLlm=true면 전송하지 않고 "보낼 내용"만 준비(승인용 미리보기). */
  dryRunLlm?: boolean;
}

export interface AnalysisBuildResult {
  analysis: UsageAnalysis;
  warnings: string[];
  /** --send 경로에서 생성된 주간 산문(있으면 renderAnalysis에 전달). */
  narrative?: string;
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
}

/** 개인 사용 분석을 빌드(세션 발견·수집 → analyze). CLI/MCP 공유 코어. */
export async function buildAnalysis(opts: AnalysisBuildOptions = {}): Promise<AnalysisBuildResult> {
  const warnings: string[] = [];
  const files = opts.sessionFiles ?? (await discoverSessionFiles(opts.projectsDir));
  const parsed = await readSessionFiles(files);
  for (const w of parsed.warnings) warnings.push(formatParseWarning(w));

  const analyzeOpts: AnalyzeOptions = {};
  if (opts.start) analyzeOpts.start = opts.start;
  if (opts.end) analyzeOpts.end = opts.end;
  const analysis = analyze(parsed.sessions, analyzeOpts);

  const result: AnalysisBuildResult = { analysis, warnings };

  // LLM 서술(선택). 세션이 있을 때만. 실패하면 결정적 문서로 폴백(§4.4).
  if (opts.useLlm && analysis.totals.sessions > 0) {
    if (opts.dryRunLlm) {
      try {
        result.preview = prepareNarrativeSend(analysis);
      } catch (err) {
        warnings.push(`전송 준비 실패(마스킹 차단): ${(err as Error).message}`);
      }
    } else if (opts.summarizer) {
      try {
        const { prose, redactions } = await narrateUsage(analysis, opts.summarizer);
        result.narrative = prose;
        if (redactions.length > 0) warnings.push(`마스킹: ${redactions.length}개 비밀 가림 후 전송`);
      } catch (err) {
        warnings.push(`LLM 서술 실패 — 결정적 문서만: ${(err as Error).message}`);
      }
    }
  }

  return result;
}
