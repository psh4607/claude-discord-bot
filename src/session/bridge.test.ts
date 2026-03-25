import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextChannel } from 'discord.js';
import { SessionBridge } from './bridge.js';
import type { MessageSender } from '../message/sender.js';
import type { SessionLogger } from './logger.js';
import type { Workspace } from './workspace.js';

// query()를 모킹
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

function makeAsyncGenerator<T>(items: T[]): AsyncIterable<T> & { close: () => void } {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) {
        yield item;
      }
    },
    close: vi.fn(),
  };
}

function makeBridge(initialSessionId = '') {
  const channel = {
    id: 'channel-1',
    send: vi.fn().mockResolvedValue({}),
  } as unknown as TextChannel;

  const workspace = {
    saveSessionId: vi.fn().mockResolvedValue(undefined),
  } as unknown as Workspace;

  const sender = {
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
    finalizeStatusLog: vi.fn().mockResolvedValue(undefined),
    sendResponse: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageSender;

  const logger = {
    logUser: vi.fn().mockResolvedValue(undefined),
    logAssistant: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionLogger;

  const bridge = new SessionBridge(
    'channel-1',
    channel,
    '/workspace/channel-1',
    workspace,
    sender,
    logger,
    { permissionMode: 'bypassPermissions' },
    initialSessionId,
  );

  return { bridge, channel, workspace, sender, logger };
}

describe('SessionBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueue된 메시지를 순차 처리한다', async () => {
    const { bridge, sender } = makeBridge();

    const gen1 = makeAsyncGenerator([
      { type: 'result', subtype: 'success', session_id: 'sess-1', result: '응답1' },
    ]);
    const gen2 = makeAsyncGenerator([
      { type: 'result', subtype: 'success', session_id: 'sess-1', result: '응답2' },
    ]);

    vi.mocked(query)
      .mockReturnValueOnce(gen1 as any)
      .mockReturnValueOnce(gen2 as any);

    bridge.enqueue('메시지1', 'user1');
    bridge.enqueue('메시지2', 'user2');

    // 큐 처리가 비동기이므로 잠시 대기
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect(sender.sendResponse).toHaveBeenCalledTimes(2);
  });

  it('sessionId를 캡처하여 저장한다', async () => {
    const { bridge, workspace } = makeBridge();

    const gen = makeAsyncGenerator([
      { type: 'result', subtype: 'success', session_id: 'captured-sess-id', result: '응답' },
    ]);
    vi.mocked(query).mockReturnValueOnce(gen as any);

    bridge.enqueue('안녕', 'user1');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridge.currentSessionId).toBe('captured-sess-id');
    expect(workspace.saveSessionId).toHaveBeenCalledWith('channel-1', 'captured-sess-id');
  });

  it('두 번째 메시지에서 resume 옵션을 사용한다', async () => {
    const { bridge } = makeBridge('existing-sess');

    const gen = makeAsyncGenerator([
      { type: 'result', subtype: 'success', session_id: 'existing-sess', result: '응답' },
    ]);
    vi.mocked(query).mockReturnValueOnce(gen as any);

    bridge.enqueue('메시지', 'user1');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ resume: 'existing-sess' }),
      }),
    );
  });

  it('shuttingDown 시 enqueue를 무시한다', async () => {
    const { bridge } = makeBridge();

    bridge.shutdown();
    bridge.enqueue('무시되어야 할 메시지', 'user1');

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  it('abort 시 activeQuery를 close한다', async () => {
    const { bridge } = makeBridge();

    // 처리 중 상태를 만들기 위해 느린 제너레이터 사용
    let resolveFn!: () => void;
    const slowGen = {
      [Symbol.asyncIterator]: async function* () {
        await new Promise<void>((resolve) => { resolveFn = resolve; });
        yield { type: 'result', subtype: 'success', session_id: 's', result: 'r' };
      },
      close: vi.fn(),
    };

    vi.mocked(query).mockReturnValueOnce(slowGen as any);

    bridge.enqueue('메시지', 'user1');
    await new Promise((resolve) => setTimeout(resolve, 10));

    bridge.abort();

    expect(slowGen.close).toHaveBeenCalled();
    resolveFn?.();
  });

  it('resetSession 시 sessionId를 초기화한다', () => {
    const { bridge } = makeBridge('some-session-id');

    expect(bridge.currentSessionId).toBe('some-session-id');
    bridge.resetSession();
    expect(bridge.currentSessionId).toBe('');
  });

  it('error 타입 결과 수신 시 오류 메시지를 전송한다', async () => {
    const { bridge, channel, logger } = makeBridge();

    const gen = makeAsyncGenerator([
      { type: 'result', subtype: 'error_during_execution' },
    ]);
    vi.mocked(query).mockReturnValueOnce(gen as any);

    bridge.enqueue('메시지', 'user1');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(logger.logError).toHaveBeenCalledWith('error_during_execution');
    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('오류가 발생했습니다'));
  });
});
