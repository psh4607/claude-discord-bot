import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
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

  it('saveSessionId / loadSessionId: 영속화', async () => {
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
