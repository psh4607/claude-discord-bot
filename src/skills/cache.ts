import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { scanSkillFiles, type SkillEntry } from './scanner.js';

export class SkillCache {
  private skills: SkillEntry[] = [];
  private watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private commandDirs: string[],
    private pluginDirs: string[],
  ) {}

  static createDefault(projectDir?: string): SkillCache {
    const home = homedir();
    const commandDirs = [
      join(home, '.claude', 'commands'),
      ...(projectDir ? [join(projectDir, '.claude', 'commands')] : []),
    ];
    const pluginDirs = [join(home, '.claude', 'plugins')];
    return new SkillCache(commandDirs, pluginDirs);
  }

  async initialize(): Promise<void> {
    this.skills = await scanSkillFiles(this.commandDirs, this.pluginDirs);
    console.log(`스킬 ${this.skills.length}개 로드 완료`);
  }

  getAll(): SkillEntry[] {
    return this.skills;
  }

  search(query: string): SkillEntry[] {
    if (!query) return this.skills;
    const q = query.toLowerCase();
    return this.skills.filter(
      s => s.fullName.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }

  getByNamespace(namespace: string): SkillEntry[] {
    return this.skills.filter(s => s.namespace === namespace);
  }

  startWatching(): void {
    for (const dir of [...this.commandDirs, ...this.pluginDirs]) {
      try {
        const watcher = watch(dir, { recursive: true }, () => this.debouncedRefresh());
        this.watchers.push(watcher);
      } catch {
        /* 디렉토리 없으면 건너뜀 */
      }
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  get count(): number {
    return this.skills.length;
  }

  private debouncedRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.initialize().catch(err => console.error('스킬 캐시 갱신 실패:', err));
    }, 5000);
  }
}
