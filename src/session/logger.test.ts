import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionLogger } from './logger.js';

describe('SessionLogger', () => {
  let discordDir: string;
  let logger: SessionLogger;

  beforeEach(async () => {
    discordDir = await mkdtemp(join(tmpdir(), 'logger-test-'));
    logger = new SessionLogger(discordDir);
  });

  afterEach(async () => {
    await rm(discordDir, { recursive: true, force: true });
  });

  it('사용자 메시지를 기록한다', async () => {
    await logger.logUser('testuser', '안녕하세요');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('👤');
    expect(content).toContain('testuser');
    expect(content).toContain('안녕하세요');
  });

  it('Claude 응답을 기록한다', async () => {
    await logger.logAssistant('안녕하세요! 도움이 필요하신가요?');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('🤖 Claude');
    expect(content).toContain('안녕하세요! 도움이 필요하신가요?');
  });

  it('긴 응답을 truncate한다', async () => {
    const longResponse = 'a'.repeat(600);
    await logger.logAssistant(longResponse);
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('...(생략)');
    expect(content).not.toContain(longResponse);
  });

  it('도구 사용을 기록한다', async () => {
    await logger.logToolUse('Read', { file_path: 'src/index.ts' });
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('Read');
    expect(content).toContain('src/index.ts');
  });

  it('도구 결과를 기록한다', async () => {
    await logger.logToolResult('Read', true);
    await logger.logToolResult('Bash', false, 'exit 1');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('✅');
    expect(content).toContain('❌');
    expect(content).toContain('exit 1');
  });

  it('일별 로테이션으로 파일이 생성된다', () => {
    const logPath = logger.currentLogPath();
    const today = new Date().toISOString().slice(0, 10);
    expect(logPath).toContain('chat-history');
    expect(logPath).toContain(today);
  });

  it('오류를 기록한다', async () => {
    await logger.logError('세션 만료');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('❌ 오류');
    expect(content).toContain('세션 만료');
  });
});
