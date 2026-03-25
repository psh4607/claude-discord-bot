import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, TextChannel } from 'discord.js';

import type { Config } from '../config/index.js';
import type { MessageSender } from '../message/sender.js';
import type { Workspace } from './workspace.js';
import { SessionPool } from './pool.js';

const mockShutdowns = new Map<string, ReturnType<typeof vi.fn>>();

vi.mock('./bridge.js', () => ({
  SessionBridge: class {
    channelId: string;
    shutdown: ReturnType<typeof vi.fn>;
    constructor(channelId: string) {
      this.channelId = channelId;
      this.shutdown = vi.fn();
      mockShutdowns.set(channelId, this.shutdown);
    }
  },
}));

vi.mock('./logger.js', () => ({
  SessionLogger: class {
    constructor() {}
  },
}));

vi.mock('./options.js', () => ({
  createQueryOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('../storage/archive.js', () => ({
  archiveSession: vi.fn().mockResolvedValue({ archivePath: '/archive/ch-1', channelId: 'ch-1' }),
}));

function makePool() {
  const workspace = {
    create: vi.fn().mockResolvedValue('/workspaces/ch-1'),
    getWorkspacePath: vi.fn().mockReturnValue('/workspaces/ch-1'),
    loadSessionId: vi.fn().mockResolvedValue('sess-1'),
    getDiscordDir: vi.fn().mockReturnValue('/workspaces/ch-1/.discord'),
  } as unknown as Workspace;

  const sender = {
    stopTyping: vi.fn(),
    clearStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageSender;

  const config = {} as Config;
  const client = {} as Client;

  const pool = new SessionPool(workspace, sender, config, client);

  return { pool, workspace, sender };
}

function makeChannel(id = 'ch-1') {
  return { id } as unknown as TextChannel;
}

describe('SessionPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('has() / get()', () => {
    it('존재하지 않는 channelId에 대해 has()는 false를 반환한다', () => {
      const { pool } = makePool();
      expect(pool.has('nonexistent')).toBe(false);
    });

    it('create() 후 has()는 true를 반환한다', async () => {
      const { pool } = makePool();
      await pool.create('ch-1', makeChannel());
      expect(pool.has('ch-1')).toBe(true);
    });

    it('get()은 등록된 bridge를 반환한다', async () => {
      const { pool } = makePool();
      const bridge = await pool.create('ch-1', makeChannel());
      expect(pool.get('ch-1')).toBe(bridge);
    });

    it('get()은 미등록 channelId에 undefined를 반환한다', () => {
      const { pool } = makePool();
      expect(pool.get('nonexistent')).toBeUndefined();
    });
  });

  describe('create()', () => {
    it('workspace.create()를 호출하고 bridge를 반환한다', async () => {
      const { pool, workspace } = makePool();
      const bridge = await pool.create('ch-1', makeChannel());
      expect(workspace.create).toHaveBeenCalledWith('ch-1');
      expect(bridge).toBeDefined();
    });
  });

  describe('restore()', () => {
    it('workspace.getWorkspacePath()와 loadSessionId()를 사용한다', async () => {
      const { pool, workspace } = makePool();
      await pool.restore('ch-1', makeChannel());
      expect(workspace.getWorkspacePath).toHaveBeenCalledWith('ch-1');
      expect(workspace.loadSessionId).toHaveBeenCalledWith('ch-1');
    });

    it('restore() 후 bridge가 풀에 등록된다', async () => {
      const { pool } = makePool();
      await pool.restore('ch-1', makeChannel());
      expect(pool.has('ch-1')).toBe(true);
    });
  });

  describe('close()', () => {
    it('bridge가 없으면 null을 반환한다', async () => {
      const { pool } = makePool();
      const result = await pool.close('nonexistent');
      expect(result).toBeNull();
    });

    it('close() 후 bridge가 풀에서 제거된다', async () => {
      const { pool } = makePool();
      await pool.create('ch-1', makeChannel());
      await pool.close('ch-1', 'test-channel');
      expect(pool.has('ch-1')).toBe(false);
    });

    it('close() 시 bridge.shutdown()을 호출한다', async () => {
      const { pool } = makePool();
      const bridge = await pool.create('ch-1', makeChannel());
      await pool.close('ch-1', 'test-channel');
      expect(bridge.shutdown).toHaveBeenCalled();
    });

    it('close() 시 archiveSession 결과를 반환한다', async () => {
      const { pool } = makePool();
      await pool.create('ch-1', makeChannel());
      const result = await pool.close('ch-1', 'test-channel');
      expect(result).toEqual({ archivePath: '/archive/ch-1', channelId: 'ch-1' });
    });
  });

  describe('shutdown()', () => {
    it('shutdown() 시 모든 bridge.shutdown()을 호출하고 비운다', async () => {
      const { pool } = makePool();
      const b1 = await pool.create('ch-1', makeChannel('ch-1'));
      const b2 = await pool.create('ch-2', makeChannel('ch-2'));

      pool.shutdown();

      expect(b1.shutdown).toHaveBeenCalled();
      expect(b2.shutdown).toHaveBeenCalled();
      expect(pool.activeCount).toBe(0);
    });
  });

  describe('activeCount', () => {
    it('빈 풀의 activeCount는 0이다', () => {
      const { pool } = makePool();
      expect(pool.activeCount).toBe(0);
    });

    it('bridge 추가 시 activeCount가 증가한다', async () => {
      const { pool } = makePool();
      await pool.create('ch-1', makeChannel('ch-1'));
      await pool.create('ch-2', makeChannel('ch-2'));
      expect(pool.activeCount).toBe(2);
    });

    it('close() 후 activeCount가 감소한다', async () => {
      const { pool } = makePool();
      await pool.create('ch-1', makeChannel());
      await pool.close('ch-1');
      expect(pool.activeCount).toBe(0);
    });
  });
});
