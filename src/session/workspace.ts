import { mkdir, rename, readFile, writeFile, access, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const CLAUDE_MD_TEMPLATE = `# Claude Code 세션

이 워크스페이스에서 자유롭게 작업할 수 있습니다.
`;

export class Workspace {
  private workspacesDir: string;
  private archivesDir: string;
  private longTermDir: string;

  constructor(dataDir: string) {
    this.workspacesDir = join(dataDir, 'workspaces');
    this.archivesDir = join(dataDir, 'archives');
    this.longTermDir = join(dataDir, 'long-term');
  }

  async create(channelId: string): Promise<string> {
    const dir = join(this.workspacesDir, channelId);
    await mkdir(join(dir, '.discord', 'chat-history'), { recursive: true });
    await writeFile(join(dir, 'CLAUDE.md'), CLAUDE_MD_TEMPLATE);
    return dir;
  }

  async archive(channelId: string, channelName: string): Promise<string> {
    const src = join(this.workspacesDir, channelId);
    const timestamp = Date.now();
    const dest = join(this.archivesDir, `${channelId}_${timestamp}`);
    await mkdir(this.archivesDir, { recursive: true });
    await rename(src, dest);

    const metadata = {
      channelId,
      channelName,
      createdAt: new Date().toISOString(),
      archivedAt: new Date().toISOString(),
      movedToLongTermAt: null,
    };
    await writeFile(join(dest, 'metadata.json'), JSON.stringify(metadata, null, 2));
    return dest;
  }

  async cleanup(channelId: string): Promise<void> {
    const { rm: rmDir } = await import('node:fs/promises');
    const dir = join(this.workspacesDir, channelId);
    await rmDir(dir, { recursive: true, force: true });
  }

  async saveSessionId(channelId: string, sessionId: string): Promise<void> {
    const discordDir = join(this.workspacesDir, channelId, '.discord');
    await mkdir(discordDir, { recursive: true });
    const filePath = join(discordDir, 'session.json');
    await writeFile(filePath, JSON.stringify({ sessionId }));
  }

  async loadSessionId(channelId: string): Promise<string | null> {
    const newPath = join(this.workspacesDir, channelId, '.discord', 'session.json');
    const oldPath = join(this.workspacesDir, channelId, 'session.json');

    try {
      await access(newPath);
      const data = JSON.parse(await readFile(newPath, 'utf-8'));
      return data.sessionId ?? null;
    } catch {
      // 신규 경로 없음 — 구 경로 확인
    }

    try {
      await access(oldPath);
      const data = JSON.parse(await readFile(oldPath, 'utf-8'));

      // 신규 경로로 마이그레이션
      const discordDir = join(this.workspacesDir, channelId, '.discord');
      await mkdir(discordDir, { recursive: true });
      await copyFile(oldPath, newPath);
      await rm(oldPath);

      return data.sessionId ?? null;
    } catch {
      return null;
    }
  }

  getWorkspacePath(channelId: string): string {
    return join(this.workspacesDir, channelId);
  }

  getDiscordDir(channelId: string): string {
    return join(this.workspacesDir, channelId, '.discord');
  }

  get paths() {
    return {
      workspaces: this.workspacesDir,
      archives: this.archivesDir,
      longTerm: this.longTermDir,
    };
  }
}
