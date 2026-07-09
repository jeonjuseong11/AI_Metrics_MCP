/**
 * 스크럼 초안 오케스트레이터 — CLI/hook/MCP가 공유하는 코어 함수(부록 A A3).
 *
 *   세션 발견·수집 ─┐
 *                   ├─ KST 일자 필터 ─ 메트릭 집계 ─┐
 *   git 수집 ───────┘                                ├─ 렌더 ─ 초안
 *                     (커밋 KST 일자 필터) ──────────┘
 *
 * LLM 요약(standup)·서술(analyze)은 연동됨 — 마스킹 경계를 통과한 뒤에만 전송하고,
 * 실패하면 결정적 폴백(§4.4). analyze는 --repo 시 같은 시간창의 커밋 타입(작업 성격)을
 * 선택적으로 결합한다.
 */

import { aggregate } from "./metrics.js";
import { analyze, type AnalyzeOptions, type SourceMeta, type UsageAnalysis } from "./analysis.js";
import { commitsOnKstDay, kstDayRange, sessionsOnKstDay, yesterdayKst } from "./day.js";
import { renderDraft, type DraftOptions } from "./render.js";
import { prepareSend, summarizeAccomplishments } from "./summarize.js";
import { prepareNarrativeSend, narrateUsage } from "./narrative.js";
import { summarizeSituation, type SituationSummary } from "./situation.js";
import type { Redaction } from "./mask.js";
import { collectCommits } from "../fs/git.js";
import { claudeCodeAdapter } from "../adapters/claudeCode.js";
import { cursorAdapter } from "../adapters/cursor.js";
import { codexAdapter } from "../adapters/codex.js";
import type { CollectOptions, SourceAdapter } from "../adapters/types.js";
import type { Commit } from "../parse/git.js";
import type { Summarizer } from "../llm/summarizer.js";
import type { NormalizedSession, ParseResult, ParseWarning } from "../types.js";

/** analyze/portrait의 production 멀티소스 어댑터. cli·mcp analyze가 명시 주입(코어 기본은 claude-only). */
export const ANALYSIS_ADAPTERS: SourceAdapter[] = [claudeCodeAdapter, cursorAdapter, codexAdapter];

export interface StandupOptions {
  /** KST 날짜 "YYYY-MM-DD". 없으면 now 기준 어제. */
  date?: string;
  author?: string;
  /** git 커밋을 수집할 저장소 경로. 없으면 커밋 생략. */
  repoPath?: string;
  /** 명시 세션 파일. 없으면 projectsDir에서 발견. */
  sessionFiles?: string[];
  projectsDir?: string;
  /** AI 사용 소스 어댑터 목록. 기본 [claudeCodeAdapter](claude-only). cli/mcp analyze가 ANALYSIS_ADAPTERS 주입. */
  adapters?: SourceAdapter[];
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
  const adapters = opts.adapters ?? [claudeCodeAdapter];
  // 기본은 claude-only(코어 결정성·테스트 footgun 방지). 멀티소스는 cli/mcp analyze가 ANALYSIS_ADAPTERS를 명시 주입.
  // sessionFiles:[](빈 배열, truthy)는 paths=[]로 보존돼 자동 발견을 건너뛴다 — .length 가드로 바꾸지 말 것.
  const collectOpts: CollectOptions = {};
  if (opts.sessionFiles) collectOpts.paths = opts.sessionFiles;
  if (opts.projectsDir) collectOpts.rootDir = opts.projectsDir;
  const collected = await Promise.all(
    adapters.map(async (a) => {
      try {
        // 레거시 sessionFiles/projectsDir는 Claude Code 전용 — 타 소스엔 자기 기본 발견을 쓴다.
        const r = await a.collect(a.id === claudeCodeAdapter.id ? collectOpts : {});
        return { sessions: r.sessions.map((s) => ({ ...s, source: a.id })), warnings: r.warnings };
      } catch (e) {
        return {
          sessions: [] as NormalizedSession[],
          warnings: [{ line: 0, reason: `${a.id} 수집 실패: ${(e as Error).message}` }] as ParseWarning[],
        };
      }
    }),
  );
  const parsed: ParseResult = {
    sessions: collected.flatMap((c) => c.sessions),
    warnings: collected.flatMap((c) => c.warnings),
  };
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
  /** AI 사용 소스 어댑터 목록. 기본 [claudeCodeAdapter](claude-only). cli/mcp analyze가 ANALYSIS_ADAPTERS 주입. */
  adapters?: SourceAdapter[];
  /** 주어지고 useLlm=true면 주간 사용을 LLM으로 서술(실패 시 결정적 문서로 폴백). */
  summarizer?: Summarizer;
  useLlm?: boolean;
  /** useLlm이면서 dryRunLlm=true면 전송하지 않고 "보낼 내용"만 준비(승인용 미리보기). */
  dryRunLlm?: boolean;
  /** 주어지면 같은 시간창의 커밋 타입 분포(작업 성격)를 수집한다. */
  repoPath?: string;
  /** 커밋 작성자 필터(+분석 문서 헤더와 동일 값 재사용). */
  author?: string;
  /** 테스트·주입용 커밋 수집기. 미지정 시 실제 collectCommits. */
  commitCollector?: typeof collectCommits;
}

export interface AnalysisBuildResult {
  analysis: UsageAnalysis;
  warnings: string[];
  /** --send 경로에서 생성된 주간 산문(있으면 renderAnalysis에 전달). */
  narrative?: string;
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
  /** --repo 주어졌을 때의 작업 성격(커밋 타입 분포). */
  situation?: SituationSummary;
}

/** collectSessions 입력 — 어댑터에 넘길 공통 수집 옵션(소스-특화 해석은 어댑터). */
export interface CollectCommon {
  sessionFiles?: string[];
  projectsDir?: string;
  /** 자동 발견 파일을 mtime ≥ 이 값으로 좁히는 성근 프리필터(거울/today의 startup 상수화). 미지정=전체. */
  sinceMtimeMs?: number;
}

export interface CollectResult {
  sessions: NormalizedSession[];
  warnings: string[];
  sourceMeta: SourceMeta;
}

/**
 * 어댑터들에서 세션을 **1회** 수집·소스태깅하고 sourceMeta(id→providesCost)를 만든다.
 *
 * analyze()가 이미 인메모리로 range 필터 + cost-unknown 격리를 하므로(analysis.ts), 거울/today는
 * 이걸 1회 호출하고 analyze()를 범위별로 여러 번 부른다(parse-once — 디스크 파싱은 한 번).
 * sourceMeta·source 태깅을 보존해 E5 격리(Cursor cost-unknown)가 유지된다.
 */
export async function collectSessions(
  common: CollectCommon,
  adapters: SourceAdapter[] = [claudeCodeAdapter],
): Promise<CollectResult> {
  // sessionFiles:[](빈 배열, truthy)는 paths=[]로 보존돼 자동 발견을 건너뛴다 — .length 가드로 바꾸지 말 것.
  const collectOpts: CollectOptions = {};
  if (common.sessionFiles) collectOpts.paths = common.sessionFiles;
  if (common.projectsDir) collectOpts.rootDir = common.projectsDir;
  if (common.sinceMtimeMs !== undefined) collectOpts.sinceMtimeMs = common.sinceMtimeMs;

  const collected = await Promise.all(
    adapters.map(async (a) => {
      try {
        // 레거시 sessionFiles/projectsDir/sinceMtimeMs는 Claude Code 전용 — 타 소스엔 자기 기본 발견을 쓴다.
        const r = await a.collect(a.id === claudeCodeAdapter.id ? collectOpts : {});
        return { sessions: r.sessions.map((s) => ({ ...s, source: a.id })), warnings: r.warnings };
      } catch (e) {
        return {
          sessions: [] as NormalizedSession[],
          warnings: [{ line: 0, reason: `${a.id} 수집 실패: ${(e as Error).message}` }] as ParseWarning[],
        };
      }
    }),
  );

  const sessions = collected.flatMap((c) => c.sessions);
  const warnings = collected.flatMap((c) => c.warnings).map(formatParseWarning);
  const sourceMeta: SourceMeta = new Map(
    adapters.map((a): [string, { displayName: string; providesCost: boolean }] => [
      a.id,
      { displayName: a.displayName, providesCost: a.providesCost },
    ]),
  );
  return { sessions, warnings, sourceMeta };
}

/** 개인 사용 분석을 빌드(세션 발견·수집 → analyze). CLI/MCP 공유 코어. */
export async function buildAnalysis(opts: AnalysisBuildOptions = {}): Promise<AnalysisBuildResult> {
  // 기본은 claude-only(코어 결정성·테스트 footgun 방지). 멀티소스는 cli/mcp analyze가 ANALYSIS_ADAPTERS를 명시 주입.
  const adapters = opts.adapters ?? [claudeCodeAdapter];
  const common: CollectCommon = {};
  if (opts.sessionFiles) common.sessionFiles = opts.sessionFiles;
  if (opts.projectsDir) common.projectsDir = opts.projectsDir;
  const collected = await collectSessions(common, adapters);
  const warnings: string[] = [...collected.warnings];

  const analyzeOpts: AnalyzeOptions = {};
  if (opts.start) analyzeOpts.start = opts.start;
  if (opts.end) analyzeOpts.end = opts.end;
  const analysis = analyze(collected.sessions, analyzeOpts, collected.sourceMeta);

  const result: AnalysisBuildResult = { analysis, warnings };

  // 상황 신호(선택): --repo 주어지면 분석 기간과 같은 시간창의 커밋 타입 분포.
  // 작업 성격은 세션 분석에 부속된다 — 세션이 0이면 수집하지 않고(git 낭비 방지) 무시 사유를 알린다.
  // (세션>0이면 analysis.range는 항상 비어있지 않다.) 어떤 실패도 결정적 문서를 막지 않는다(폴백).
  let situation: SituationSummary | undefined;
  if (opts.repoPath) {
    if (analysis.totals.sessions === 0) {
      warnings.push("--repo가 주어졌으나 분석할 AI 세션이 없어 작업 성격을 생략했습니다(작업 성격은 세션 분석에 부속됩니다).");
    } else {
      try {
        const collector = opts.commitCollector ?? collectCommits;
        const startUtc = kstDayRange(analysis.range.start).startUtc;
        const endUtc = kstDayRange(analysis.range.end).endUtc;
        const r = await collector(opts.repoPath, startUtc, endUtc, opts.author);
        if (r.warning) warnings.push(r.warning);
        const s = summarizeSituation(r.commits);
        if (s.total > 0) {
          situation = s;
          result.situation = s;
        }
      } catch (err) {
        warnings.push(`상황 신호 수집 실패: ${(err as Error).message}`);
      }
    }
  }

  // LLM 서술(선택). 세션이 있을 때만. 실패하면 결정적 문서로 폴백(§4.4).
  if (opts.useLlm && analysis.totals.sessions > 0) {
    if (opts.dryRunLlm) {
      try {
        result.preview = prepareNarrativeSend(analysis, situation);
      } catch (err) {
        warnings.push(`전송 준비 실패(마스킹 차단): ${(err as Error).message}`);
      }
    } else if (opts.summarizer) {
      try {
        const { prose, redactions } = await narrateUsage(analysis, opts.summarizer, situation);
        result.narrative = prose;
        if (redactions.length > 0) warnings.push(`마스킹: ${redactions.length}개 비밀 가림 후 전송`);
      } catch (err) {
        warnings.push(`LLM 서술 실패 — 결정적 문서만: ${(err as Error).message}`);
      }
    }
  }

  return result;
}
