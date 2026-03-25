import { basename } from 'node:path';

import type { TextChannel } from 'discord.js';

import type { MessageSender } from '../message/sender.js';
import type { SessionLogger } from './logger.js';

export function createHooks(channel: TextChannel, sender: MessageSender, logger: SessionLogger) {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input: { hook_event_name: string; tool_name: string; tool_input: unknown }, _toolUseId: string | undefined, _opts: { signal: AbortSignal }) => {
            if (input.hook_event_name !== 'PreToolUse') return {};
            const label = toolLabel(input.tool_name, input.tool_input);
            await sender.appendStatusLog(channel, label);
            logger.logToolUse(input.tool_name, input.tool_input);
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (input: { hook_event_name: string; tool_name: string }) => {
            if (input.hook_event_name !== 'PostToolUse') return {};
            logger.logToolResult(input.tool_name, true);
            return {};
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async (input: { hook_event_name: string; tool_name: string; error: string }) => {
            if (input.hook_event_name !== 'PostToolUseFailure') return {};
            logger.logToolResult(input.tool_name, false, input.error);
            return {};
          },
        ],
      },
    ],
  };
}

export function toolLabel(name: string, input: unknown): string {
  const i = input as Record<string, unknown>;
  const labels: Record<string, (i: Record<string, unknown>) => string> = {
    Read: (i) =>
      `📖 ${basename(String(i.file_path ?? ''))}${i.offset ? ` (${i.offset}~${Number(i.offset) + Number(i.limit ?? 2000)}줄)` : ''} 읽는 중...`,
    Edit: (i) => `✏️ ${basename(String(i.file_path ?? ''))} 수정 중...`,
    Write: (i) => `📝 ${basename(String(i.file_path ?? ''))} 작성 중...`,
    Bash: (i) => `⚡ \`${truncate(String(i.description ?? i.command ?? ''), 40)}\` 실행 중...`,
    Grep: (i) =>
      `🔎 "${truncate(String(i.pattern ?? ''), 30)}" ${i.path ? `in ${basename(String(i.path))}` : ''} 검색 중...`,
    Glob: (i) => `🔍 ${truncate(String(i.pattern ?? ''), 40)} 탐색 중...`,
    Agent: () => `🤖 서브에이전트 실행 중...`,
  };
  return labels[name]?.(i) ?? `🔧 ${name} 실행 중...`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}
