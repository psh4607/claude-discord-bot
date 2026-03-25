import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from './workspace.js';

describe('Workspace', () => {
  let baseDir: string;
  let workspace: Workspace;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ws-test-'));
    workspace = new Workspace(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('create: 작업 디렉토리 생성', async () => {
    const path = await workspace.create('ch-123');
    expect(path).toContain('ch-123');
    const entries = await readdir(join(baseDir, 'workspaces'));
    expect(entries).toContain('ch-123');
  });

  it('create: .discord/ 디렉토리 생성', async () => {
    await workspace.create('ch-123');
    const discordDir = join(baseDir, 'workspaces', 'ch-123', '.discord');
    await expect(access(discordDir)).resolves.toBeUndefined();
  });

  it('create: .discord/chat-history/ 디렉토리 생성', async () => {
    await workspace.create('ch-123');
    const chatHistoryDir = join(baseDir, 'workspaces', 'ch-123', '.discord', 'chat-history');
    await expect(access(chatHistoryDir)).resolves.toBeUndefined();
  });

  it('create: CLAUDE.md 기본 템플릿 생성', async () => {
    await workspace.create('ch-123');
    const claudeMdPath = join(baseDir, 'workspaces', 'ch-123', 'CLAUDE.md');
    const content = await readFile(claudeMdPath, 'utf-8');
    expect(content).toContain('Claude Code 세션');
  });

  it('saveSessionId / loadSessionId: .discord/session.json에 저장', async () => {
    await workspace.create('ch-123');
    await workspace.saveSessionId('ch-123', 'sess-abc');
    const sessionPath = join(baseDir, 'workspaces', 'ch-123', '.discord', 'session.json');
    const data = JSON.parse(await readFile(sessionPath, 'utf-8'));
    expect(data.sessionId).toBe('sess-abc');
  });

  it('loadSessionId: .discord/session.json에서 읽기', async () => {
    await workspace.create('ch-123');
    await workspace.saveSessionId('ch-123', 'sess-abc');
    const id = await workspace.loadSessionId('ch-123');
    expect(id).toBe('sess-abc');
  });

  it('loadSessionId: 파일 없으면 null', async () => {
    await workspace.create('ch-123');
    const id = await workspace.loadSessionId('ch-123');
    expect(id).toBeNull();
  });

  it('loadSessionId: 구 경로 session.json에서 자동 마이그레이션', async () => {
    // 구 경로에 session.json 수동으로 생성
    const workspaceDir = join(baseDir, 'workspaces', 'ch-migrate');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'session.json'), JSON.stringify({ sessionId: 'old-sess' }));

    const id = await workspace.loadSessionId('ch-migrate');
    expect(id).toBe('old-sess');

    // 신규 경로로 마이그레이션 확인
    const newPath = join(workspaceDir, '.discord', 'session.json');
    const data = JSON.parse(await readFile(newPath, 'utf-8'));
    expect(data.sessionId).toBe('old-sess');

    // 구 경로 삭제 확인
    await expect(access(join(workspaceDir, 'session.json'))).rejects.toThrow();
  });

  it('getDiscordDir: .discord/ 경로 반환', () => {
    const discordDir = workspace.getDiscordDir('ch-123');
    expect(discordDir).toBe(join(baseDir, 'workspaces', 'ch-123', '.discord'));
  });

  it('archive: workspaces → archives 이동', async () => {
    await workspace.create('ch-123');
    const archivePath = await workspace.archive('ch-123', 'my-channel');
    expect(archivePath).toContain('archives');
    expect(archivePath).toContain('ch-123');

    const workspaces = await readdir(join(baseDir, 'workspaces'));
    expect(workspaces).not.toContain('ch-123');

    const metadata = JSON.parse(
      await readFile(join(archivePath, 'metadata.json'), 'utf-8')
    );
    expect(metadata.channelId).toBe('ch-123');
    expect(metadata.channelName).toBe('my-channel');
    expect(metadata.archivedAt).toBeDefined();
  });
});
