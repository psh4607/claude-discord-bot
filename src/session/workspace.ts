import { mkdir, rename, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

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
    await mkdir(dir, { recursive: true });
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
    const { rm } = await import('node:fs/promises');
    const dir = join(this.workspacesDir, channelId);
    await rm(dir, { recursive: true, force: true });
  }

  async saveSessionId(channelId: string, sessionId: string): Promise<void> {
    const filePath = join(this.workspacesDir, channelId, 'session.json');
    await writeFile(filePath, JSON.stringify({ sessionId }));
  }

  async loadSessionId(channelId: string): Promise<string | null> {
    const filePath = join(this.workspacesDir, channelId, 'session.json');
    try {
      await access(filePath);
      const data = JSON.parse(await readFile(filePath, 'utf-8'));
      return data.sessionId ?? null;
    } catch {
      return null;
    }
  }

  getWorkspacePath(channelId: string): string {
    return join(this.workspacesDir, channelId);
  }

  get paths() {
    return {
      workspaces: this.workspacesDir,
      archives: this.archivesDir,
      longTerm: this.longTermDir,
    };
  }
}
