/**
 * MCP 서버 — Claude Code가 호출하는 /standup·/analyze 도구(부록 A A3).
 *
 * 진입점은 얇다: 인자를 받아 코어 오케스트레이터(buildStandup/buildAnalysis)를
 * 호출하고 결과 텍스트를 돌려줄 뿐. 로직은 전부 core/에 있다.
 *
 * 안전: MCP 도구는 LLM 전송(--send)을 하지 않는다. 결정적 초안(커밋 목록 + 메트릭)과
 * 분석 문서만 반환한다. 호스트(Claude Code) 안에서 사용자가 직접 다듬을 수 있다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildStandup, buildAnalysis, ANALYSIS_ADAPTERS } from "../core/standup.js";
import { renderAnalysis } from "../core/render.js";
import { toKstDateString, isoDatePlusDays } from "../core/day.js";

const KST_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD(KST)");

/** period(week/month) → KST 창. --start/--end 없을 때 회고 기본 기간. */
function retroWindow(period: string | undefined): { start: string; end: string } {
  const end = toKstDateString(new Date());
  return { start: isoDatePlusDays(end, period === "month" ? -29 : -6), end };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "aimm", version: "0.1.0" });

  server.tool(
    "standup",
    "Claude Code 세션 + Git 커밋으로 일일 스크럼 초안을 생성한다(결정적, 전송 없음).",
    {
      date: KST_DATE.optional().describe("대상 KST 날짜(기본: 어제)"),
      author: z.string().optional().describe("git 작성자 필터 + 초안 헤더"),
      repo: z.string().optional().describe("커밋을 수집할 저장소 절대경로"),
    },
    async (args) => {
      const opts: Parameters<typeof buildStandup>[0] = {};
      if (args.date) opts.date = args.date;
      if (args.author) opts.author = args.author;
      if (args.repo) opts.repoPath = args.repo;
      const r = await buildStandup(opts);
      return { content: [{ type: "text", text: r.draft }] };
    },
  );

  server.tool(
    "analyze",
    "개인 AI 사용 분석 문서를 생성한다(모델 믹스·비용 추세·시간대·프로젝트별).",
    {
      start: KST_DATE.optional().describe("시작 KST 날짜"),
      end: KST_DATE.optional().describe("끝 KST 날짜"),
      author: z.string().optional().describe("문서 헤더"),
    },
    async (args) => {
      const opts: Parameters<typeof buildAnalysis>[0] = {};
      if (args.start) opts.start = args.start;
      if (args.end) opts.end = args.end;
      opts.adapters = ANALYSIS_ADAPTERS; // analyze 도구는 멀티소스(Claude Code + Cursor)
      const { analysis } = await buildAnalysis(opts);
      return { content: [{ type: "text", text: renderAnalysis(analysis, args.author) }] };
    },
  );

  server.tool(
    "retro",
    "회고록 — 사용 패턴 + 작업 성격을 한 회고 문서로(결정적, 전송 없음). 기간 기본 최근 1주.",
    {
      period: z.enum(["week", "month"]).optional().describe("기간 프리셋(start/end 없을 때; 기본 week)"),
      start: KST_DATE.optional().describe("시작 KST 날짜(period보다 우선)"),
      end: KST_DATE.optional().describe("끝 KST 날짜"),
      repo: z.string().optional().describe("작업 성격(커밋)을 포함할 저장소 절대경로"),
      author: z.string().optional().describe("문서 헤더"),
    },
    async (args) => {
      const opts: Parameters<typeof buildAnalysis>[0] = { adapters: ANALYSIS_ADAPTERS };
      if (args.start) opts.start = args.start;
      if (args.end) opts.end = args.end;
      if (!args.start && !args.end) {
        const w = retroWindow(args.period);
        opts.start = w.start;
        opts.end = w.end;
      }
      if (args.repo) opts.repoPath = args.repo;
      const { analysis, situation, correlation } = await buildAnalysis(opts);
      return { content: [{ type: "text", text: renderAnalysis(analysis, args.author, undefined, situation, "AI 회고", correlation) }] };
    },
  );

  return server;
}

/** stdio MCP 서버를 시작한다(Claude Code가 자식 프로세스로 띄움). */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
