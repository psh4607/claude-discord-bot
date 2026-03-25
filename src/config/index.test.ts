import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('필수 환경변수 누락 시 에러', () => {
    delete process.env.DISCORD_TOKEN;
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('기본값 적용', () => {
    process.env.DISCORD_TOKEN = 'test-token';

    process.env.DISCORD_REQUIRED_ROLE = 'admin';
    const config = loadConfig();
    expect(config.categoryName).toBe('claude');
    expect(config.dataDir).toContain('data');
    expect(config.retentionDays).toBe(30);
    expect(config.model).toBe('claude-sonnet-4-6');
  });

  it('환경변수 오버라이드', () => {
    process.env.DISCORD_TOKEN = 'test-token';

    process.env.DISCORD_REQUIRED_ROLE = 'admin';
    process.env.DISCORD_CATEGORY_NAME = 'my-claude';
    process.env.ARCHIVE_RETENTION_DAYS = '7';
    process.env.CLAUDE_MODEL = 'claude-opus-4-1';
    const config = loadConfig();
    expect(config.categoryName).toBe('my-claude');
    expect(config.retentionDays).toBe(7);
    expect(config.model).toBe('claude-opus-4-1');
  });
});
