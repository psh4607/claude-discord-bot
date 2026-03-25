# 동적 스킬 커맨드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code 스킬을 Discord 슬래시 커맨드(서브커맨드 그룹 + /skill autocomplete)로 동적 노출한다.

**Architecture:** 파일시스템 스캔으로 스킬 목록을 캐시하고, fs.watch로 변경을 감시한다. 자주 쓰는 스킬은 서브커맨드 그룹, 나머지는 /skill autocomplete로 접근.

**Tech Stack:** Node.js 22, TypeScript, discord.js v14 (SlashCommandBuilder, autocomplete), node:fs

**Spec:** `docs/superpowers/specs/2026-03-25-dynamic-skill-commands-design.md`

---

### Task 1: 스킬 스캐너 구현

**Files:**
- Create: `src/skills/scanner.ts`
- Create: `src/skills/scanner.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/skills/scanner.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkillFiles, parseFrontmatter } from './scanner.js';

describe('parseFrontmatter', () => {
  it('name과 description을 추출한다', () => {
    const content = '---\nname: brainstorming\ndescription: 브레인스토밍\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.name).toBe('brainstorming');
    expect(result.description).toBe('브레인스토밍');
  });

  it('frontmatter가 없으면 빈 객체를 반환한다', () => {
    const result = parseFrontmatter('# No frontmatter');
    expect(result.name).toBeUndefined();
  });

  it('description이 여러 줄이면 첫 줄만 추출한다', () => {
    const content = '---\nname: test\ndescription: 첫 줄\n  둘째 줄\n---';
    const result = parseFrontmatter(content);
    expect(result.description).toBe('첫 줄');
  });
});

describe('scanSkillFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-scan-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('commands 디렉토리의 .md 파일을 스캔한다', async () => {
    const commandsDir = join(tmpDir, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'backlog.md'), '---\nname: backlog\ndescription: 백로그 추가\n---');

    const skills = await scanSkillFiles([commandsDir], []);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('backlog');
    expect(skills[0].namespace).toBe('');
    expect(skills[0].fullName).toBe('backlog');
  });

  it('plugins 디렉토리의 SKILL.md를 네임스페이스와 함께 스캔한다', async () => {
    const pluginDir = join(tmpDir, 'plugins', 'superpowers', 'skills', 'brainstorming');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'SKILL.md'), '---\nname: brainstorming\ndescription: 브레인스토밍\n---');

    const skills = await scanSkillFiles([], [join(tmpDir, 'plugins')]);
    expect(skills).toHaveLength(1);
    expect(skills[0].namespace).toBe('superpowers');
    expect(skills[0].fullName).toBe('superpowers:brainstorming');
  });

  it('파싱 실패 파일은 건너뛴다', async () => {
    const commandsDir = join(tmpDir, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'broken.md'), '# No frontmatter');
    await writeFile(join(commandsDir, 'good.md'), '---\nname: good\ndescription: 정상\n---');

    const skills = await scanSkillFiles([commandsDir], []);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('good');
  });

  it('존재하지 않는 디렉토리는 건너뛴다', async () => {
    const skills = await scanSkillFiles(['/nonexistent/path'], []);
    expect(skills).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/skills/scanner.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: scanner.ts 구현**

`src/skills/scanner.ts`:
```typescript
import { readFile, readdir, access } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

export interface SkillEntry {
  name: string;
  namespace: string;
  description: string;
  fullName: string;
  source: 'user' | 'project' | 'plugin';
}

export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

export async function scanSkillFiles(
  commandDirs: string[],
  pluginDirs: string[],
): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  for (const dir of commandDirs) {
    if (!(await exists(dir))) continue;
    const files = await readdir(dir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = await readFile(join(dir, file), 'utf-8');
        const meta = parseFrontmatter(content);
        if (!meta.name) continue;
        skills.push({
          name: meta.name,
          namespace: '',
          description: meta.description ?? '',
          fullName: meta.name,
          source: 'user',
        });
      } catch { /* 파싱 실패 건너뜀 */ }
    }
  }

  for (const pluginRoot of pluginDirs) {
    if (!(await exists(pluginRoot))) continue;
    await scanPluginDir(pluginRoot, skills);
  }

  return skills;
}

async function scanPluginDir(dir: string, skills: SkillEntry[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') {
      try {
        const content = await readFile(fullPath, 'utf-8');
        const meta = parseFrontmatter(content);
        if (!meta.name) return;
        const namespace = extractNamespace(fullPath);
        skills.push({
          name: meta.name,
          namespace,
          description: meta.description ?? '',
          fullName: namespace ? `${namespace}:${meta.name}` : meta.name,
          source: 'plugin',
        });
      } catch { /* 건너뜀 */ }
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await scanPluginDir(fullPath, skills);
    }
  }
}

function extractNamespace(skillPath: string): string {
  const parts = skillPath.split('/');
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx >= 2) {
    return parts[skillsIdx - 1];
  }
  return '';
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/skills/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/skills/scanner.ts src/skills/scanner.test.ts
git commit -m "feat: 스킬 스캐너 구현 (frontmatter 파싱 + 디렉토리 스캔)"
```

---

### Task 2: 스킬 캐시 구현

**Files:**
- Create: `src/skills/cache.ts`
- Create: `src/skills/cache.test.ts`

- [ ] **Step 1: 테스트 작성**

캐시 초기화, 검색, 네임스페이스 필터 테스트. scanner를 모킹.

```typescript
describe('SkillCache', () => {
  it('initialize 후 getAll로 전체 스킬을 반환한다')
  it('search로 이름/네임스페이스를 필터링한다')
  it('getByNamespace로 특정 네임스페이스 스킬만 반환한다')
  it('count가 정확한 수를 반환한다')
});
```

- [ ] **Step 2: 테스트 실패 확인**

- [ ] **Step 3: cache.ts 구현**

```typescript
import type { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
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
    const pluginDirs = [
      join(home, '.claude', 'plugins'),
    ];
    return new SkillCache(commandDirs, pluginDirs);
  }

  async initialize(): Promise<void> {
    this.skills = await scanSkillFiles(this.commandDirs, this.pluginDirs);
    console.log(`스킬 ${this.skills.length}개 로드 완료`);
  }

  getAll(): SkillEntry[] { return this.skills; }

  search(query: string): SkillEntry[] {
    if (!query) return this.skills;
    const q = query.toLowerCase();
    return this.skills.filter(s =>
      s.fullName.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  }

  getByNamespace(namespace: string): SkillEntry[] {
    return this.skills.filter(s => s.namespace === namespace);
  }

  startWatching(): void {
    for (const dir of [...this.commandDirs, ...this.pluginDirs]) {
      try {
        const watcher = watch(dir, { recursive: true }, () => {
          this.debouncedRefresh();
        });
        this.watchers.push(watcher);
      } catch { /* 디렉토리 없으면 건너뜀 */ }
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  get count(): number { return this.skills.length; }

  private debouncedRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.initialize().catch(err =>
        console.error('스킬 캐시 갱신 실패:', err)
      );
    }, 5000);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/skills/cache.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 테스트 확인 + 커밋**

Run: `pnpm test`

```bash
git add src/skills/cache.ts src/skills/cache.test.ts
git commit -m "feat: 스킬 캐시 구현 (검색 + fs.watch 감시)"
```

---

### Task 3: commands.ts에 서브커맨드 그룹 + /skill autocomplete 추가

**Files:**
- Modify: `src/bot/commands.ts`

- [ ] **Step 1: commands.ts 수정**

기존 커맨드 배열에 추가:

1. `/skill` autocomplete 커맨드
2. `/superpowers` 서브커맨드 그룹 (brainstorming, writing-plans, test-driven-development)
3. `/omc` 서브커맨드 그룹 (ralph, autopilot, ultrawork)

`FAVORITE_SKILLS` 상수 정의. `handleInteraction`에 서브커맨드 + `/skill` 케이스 추가.

서브커맨드 핸들링:
```typescript
case 'superpowers':
case 'omc': {
  const sub = interaction.options.getSubcommand();
  const namespace = interaction.commandName === 'omc' ? 'oh-my-claudecode' : interaction.commandName;
  if (bridge) {
    bridge.enqueue(`/${namespace}:${sub}`, 'system');
    await interaction.reply(`\`/${namespace}:${sub}\` 스킬을 실행합니다.`);
  } else {
    await interaction.reply('연결된 세션이 없습니다.');
  }
  break;
}

case 'skill': {
  const name = interaction.options.getString('name', true);
  if (bridge) {
    bridge.enqueue(`/${name}`, 'system');
    await interaction.reply(`\`/${name}\` 스킬을 실행합니다.`);
  } else {
    await interaction.reply('연결된 세션이 없습니다.');
  }
  break;
}
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/bot/commands.ts
git commit -m "feat: 서브커맨드 그룹 + /skill autocomplete 추가"
```

---

### Task 4: events.ts에 autocomplete 핸들러 추가

**Files:**
- Modify: `src/bot/events.ts`

- [ ] **Step 1: events.ts 수정**

`interactionCreate` 이벤트에 autocomplete 분기 추가:

```typescript
client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const query = interaction.options.getFocused();
    const results = skillCache.search(query);
    await interaction.respond(
      results.slice(0, 25).map(s => ({
        name: `${s.fullName} — ${s.description}`.slice(0, 100),
        value: s.fullName,
      }))
    ).catch(() => {});
    return;
  }
  // ... 기존 코드
});
```

`registerEvents` 파라미터에 `skillCache: SkillCache` 추가.

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/bot/events.ts
git commit -m "feat: autocomplete 핸들러 추가 (동적 스킬 검색)"
```

---

### Task 5: 진입점 연결 + 배포

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: index.ts 수정**

SkillCache 초기화 + startWatching + shutdown 시 stopWatching 추가:

```typescript
import { SkillCache } from './skills/cache.js';

// main() 내부
const skillCache = SkillCache.createDefault();
await skillCache.initialize();
skillCache.startWatching();

registerEvents(client, pool, config, skillCache);

// shutdown 내부
skillCache.stopWatching();
```

- [ ] **Step 2: 빌드 + 테스트**

Run: `pnpm build && pnpm test`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/index.ts
git commit -m "feat: SkillCache 진입점 연결"
```

- [ ] **Step 4: push + dalpha-mac 배포**

```bash
git push origin main
ssh dalpha-mac '... git pull && pnpm install && pnpm build && pm2 restart claude-discord-bot'
```

- [ ] **Step 5: Discord에서 테스트**

- `/skill` 입력 → autocomplete 후보 확인
- `/skill brainstorming` → 스킬 실행 확인
- `/superpowers brainstorming` → 서브커맨드 실행 확인
- `/omc ralph` → 서브커맨드 실행 확인
