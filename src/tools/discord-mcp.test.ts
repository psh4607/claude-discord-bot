import { describe, it, expect, vi } from 'vitest';
import { createDiscordMcpServer, requireClaudeCategory } from './discord-mcp.js';

describe('requireClaudeCategory', () => {
  it('카테고리명 일치 시 null 반환', () => {
    const channel = { parent: { name: 'claude' } };
    expect(requireClaudeCategory(channel, 'claude')).toBeNull();
  });

  it('카테고리명 불일치 시 에러 메시지 반환', () => {
    const channel = { parent: { name: 'general' } };
    expect(requireClaudeCategory(channel, 'claude')).toBe(
      'claude 카테고리 내 채널만 대상으로 할 수 있습니다',
    );
  });

  it('parent가 null이면 에러 메시지 반환', () => {
    const channel = { parent: null };
    expect(requireClaudeCategory(channel, 'claude')).toBe(
      'claude 카테고리 내 채널만 대상으로 할 수 있습니다',
    );
  });

  it('channel이 null이면 에러 메시지 반환', () => {
    expect(requireClaudeCategory(null, 'claude')).toBe(
      'claude 카테고리 내 채널만 대상으로 할 수 있습니다',
    );
  });

  it('parent가 undefined이면 에러 메시지 반환', () => {
    const channel = {};
    expect(requireClaudeCategory(channel, 'claude')).toBe(
      'claude 카테고리 내 채널만 대상으로 할 수 있습니다',
    );
  });
});

describe('createDiscordMcpServer', () => {
  it('MCP 서버 인스턴스를 반환한다', () => {
    const mockGuild = {
      channels: { cache: new Map() },
      members: { fetch: vi.fn() },
    };
    const mockChannel = {
      id: 'channel-1',
      guild: mockGuild,
    } as any;
    const mockClient = {
      channels: { cache: new Map() },
    } as any;

    const server = createDiscordMcpServer(mockClient, mockChannel, { categoryName: 'claude' });

    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });
});
