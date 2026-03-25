import { describe, it, expect, vi } from 'vitest';
import type { TextChannel } from 'discord.js';
import { createHooks, toolLabel } from './hooks.js';
import type { MessageSender } from '../message/sender.js';
import type { SessionLogger } from './logger.js';

describe('toolLabel', () => {
  it('Read 도구 라벨', () => {
    const label = toolLabel('Read', { file_path: '/src/index.ts' });
    expect(label).toContain('📖');
    expect(label).toContain('index.ts');
  });

  it('Read 도구 라벨 (offset 포함)', () => {
    const label = toolLabel('Read', { file_path: '/src/index.ts', offset: 10, limit: 50 });
    expect(label).toContain('📖');
    expect(label).toContain('index.ts');
    expect(label).toContain('10~60');
  });

  it('Edit 도구 라벨', () => {
    const label = toolLabel('Edit', { file_path: '/src/utils.ts' });
    expect(label).toContain('✏️');
    expect(label).toContain('utils.ts');
  });

  it('Write 도구 라벨', () => {
    const label = toolLabel('Write', { file_path: '/src/new.ts' });
    expect(label).toContain('📝');
    expect(label).toContain('new.ts');
  });

  it('Bash 도구 라벨 (description)', () => {
    const label = toolLabel('Bash', { command: 'pnpm test', description: '테스트 실행' });
    expect(label).toContain('⚡');
    expect(label).toContain('테스트 실행');
  });

  it('Bash 도구 라벨 (command fallback)', () => {
    const label = toolLabel('Bash', { command: 'pnpm test' });
    expect(label).toContain('⚡');
    expect(label).toContain('pnpm test');
  });

  it('Grep 도구 라벨', () => {
    const label = toolLabel('Grep', { pattern: 'SDKSession', path: '/src' });
    expect(label).toContain('🔎');
    expect(label).toContain('SDKSession');
  });

  it('Glob 도구 라벨', () => {
    const label = toolLabel('Glob', { pattern: '**/*.ts' });
    expect(label).toContain('🔍');
    expect(label).toContain('**/*.ts');
  });

  it('Agent 도구 라벨', () => {
    const label = toolLabel('Agent', {});
    expect(label).toContain('🤖');
  });

  it('알 수 없는 도구 라벨', () => {
    const label = toolLabel('CustomTool', {});
    expect(label).toContain('🔧');
    expect(label).toContain('CustomTool');
  });

  it('긴 문자열 truncate', () => {
    const label = toolLabel('Bash', { command: 'a'.repeat(100) });
    expect(label.length).toBeLessThan(120);
  });
});

describe('createHooks', () => {
  const channel = {} as TextChannel;
  const sender = {
    appendStatusLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageSender;
  const logger = {
    logToolUse: vi.fn().mockResolvedValue(undefined),
    logToolResult: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionLogger;

  it('PreToolUse, PostToolUse, PostToolUseFailure 훅을 반환한다', () => {
    const hooks = createHooks(channel, sender, logger);
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0].hooks).toHaveLength(1);
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse[0].hooks).toHaveLength(1);
    expect(hooks.PostToolUseFailure).toHaveLength(1);
    expect(hooks.PostToolUseFailure[0].hooks).toHaveLength(1);
  });

  it('PreToolUse 훅 실행 시 sender.appendStatusLog와 logger.logToolUse를 호출한다', async () => {
    const hooks = createHooks(channel, sender, logger);
    const hookFn = hooks.PreToolUse[0].hooks[0];
    const result = await hookFn(
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/src/index.ts' }, tool_use_id: 'id1' },
      'id1',
      { signal: new AbortController().signal },
    );
    expect(sender.appendStatusLog).toHaveBeenCalledWith(channel, expect.stringContaining('index.ts'));
    expect(logger.logToolUse).toHaveBeenCalledWith('Read', { file_path: '/src/index.ts' });
    expect(result).toEqual({});
  });

  it('PreToolUse 훅은 다른 이벤트 이름이면 바로 반환한다', async () => {
    const hooks = createHooks(channel, sender, logger);
    const hookFn = hooks.PreToolUse[0].hooks[0];
    vi.clearAllMocks();
    const result = await hookFn(
      { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 'id1', tool_response: null },
      'id1',
      { signal: new AbortController().signal },
    );
    expect(sender.appendStatusLog).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('PostToolUse 훅 실행 시 logger.logToolResult(성공)를 호출한다', async () => {
    const hooks = createHooks(channel, sender, logger);
    const hookFn = hooks.PostToolUse[0].hooks[0];
    vi.clearAllMocks();
    await hookFn(
      { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 'id1', tool_response: null },
      'id1',
      { signal: new AbortController().signal },
    );
    expect(logger.logToolResult).toHaveBeenCalledWith('Read', true);
  });

  it('PostToolUseFailure 훅 실행 시 logger.logToolResult(실패)를 호출한다', async () => {
    const hooks = createHooks(channel, sender, logger);
    const hookFn = hooks.PostToolUseFailure[0].hooks[0];
    vi.clearAllMocks();
    await hookFn(
      { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: {}, tool_use_id: 'id1', error: 'exit 1' },
      'id1',
      { signal: new AbortController().signal },
    );
    expect(logger.logToolResult).toHaveBeenCalledWith('Bash', false, 'exit 1');
  });
});
