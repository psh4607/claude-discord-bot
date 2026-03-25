# 동적 스킬 커맨드 설계 문서

Claude Code의 스킬/커맨드 목록을 동적으로 읽어 Discord 슬래시 커맨드로 노출한다.

## 요구사항

- Claude Code 스킬이 Discord에서 `/superpowers brainstorming` 형태로 사용 가능
- 스킬 추가/삭제/변경 시 자동 반영 (autocomplete은 즉시, 서브커맨드는 봇 재시작 시)
- 봇이 실행되는 서버의 로컬 파일시스템에서 스킬을 읽음

## 아키텍처

### 하이브리드 접근

| 계층 | 방식 | 특징 |
|------|------|------|
| 서브커맨드 그룹 | 자주 쓰는 스킬을 `/superpowers brainstorming` 형태로 등록 | 발견성 좋음, 봇 시작 시 1회 등록 |
| `/skill` autocomplete | 전체 스킬을 검색/실행 | rate limit 없음, 즉시 반영, 커버리지 100% |

### 디렉토리 구조

```
src/
  skills/
    scanner.ts          # 스킬 파일 스캔 + frontmatter 파싱
    cache.ts            # 스킬 목록 캐시 + fs.watch 감시
  bot/
    commands.ts         # 기존 + /skill autocomplete + 서브커맨드 그룹
    events.ts           # autocomplete 핸들러 추가
```

## skills/scanner.ts — 스킬 스캔

### 스캔 경로

1. `~/.claude/commands/*.md` — 유저 커맨드 (namespace: 빈 문자열)
2. 프로젝트 `.claude/commands/*.md` — 프로젝트 커맨드 (namespace: 빈 문자열)
3. `~/.claude/plugins/**/SKILL.md` — 플러그인 스킬 (namespace: 플러그인명에서 추출)

### 데이터 모델

```typescript
export interface SkillEntry {
  name: string;           // "brainstorming", "commit"
  namespace: string;      // "superpowers", "oh-my-claudecode", ""
  description: string;    // frontmatter description
  fullName: string;       // "superpowers:brainstorming", "commit"
  source: 'user' | 'project' | 'plugin';
}
```

### frontmatter 파싱

각 `.md` 파일의 YAML frontmatter에서 `name`과 `description`을 추출:

```yaml
---
name: brainstorming
description: 브레인스토밍으로 아이디어를 설계로 발전
---
```

파싱 라이브러리 없이 정규식으로 처리 (의존성 최소화):

```typescript
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}
```

### namespace 추출

플러그인 스킬의 경로에서 namespace를 추출:

```
~/.claude/plugins/.../superpowers/.../SKILL.md → namespace: "superpowers"
~/.claude/plugins/.../oh-my-claudecode/.../SKILL.md → namespace: "oh-my-claudecode"
~/.claude/commands/backlog.md → namespace: "" (유저 커맨드)
```

플러그인 경로 패턴: `plugins/**/skills/*/SKILL.md`에서 skills 디렉토리 기준으로 부모 플러그인명 추출. 정확한 경로 패턴은 구현 시 dalpha-mac의 실제 경로를 확인하여 결정.

## skills/cache.ts — 캐시 + 감시

```typescript
export class SkillCache {
  private skills: SkillEntry[] = [];
  private watchers: FSWatcher[] = [];

  async initialize(): Promise<void>
    // scanAllSkills() 호출하여 skills 배열 채움

  getAll(): SkillEntry[]

  search(query: string): SkillEntry[]
    // name, namespace, fullName, description에서 query 포함 여부 필터

  getByNamespace(namespace: string): SkillEntry[]

  startWatching(): void
    // fs.watch()로 스킬 디렉토리 감시
    // 변경 감지 시 debounce(5초) 후 initialize() 재호출
    // 감시 경로: ~/.claude/commands/, ~/.claude/plugins/

  stopWatching(): void
    // 모든 watcher close

  get count(): number
}
```

### debounce 전략

- 파일 변경 이벤트 발생 시 5초 debounce 후 전체 재스캔
- 연속 변경(npm update 등)에서 중복 스캔 방지
- 재스캔 중 에러 시 기존 캐시 유지

## bot/commands.ts 변경

### 서브커맨드 그룹 등록

자주 쓰는 스킬을 서브커맨드 그룹으로 등록. 목록은 설정 기반:

```typescript
const FAVORITE_SKILLS: Record<string, string[]> = {
  superpowers: ['brainstorming', 'writing-plans', 'test-driven-development'],
  'oh-my-claudecode': ['ralph', 'autopilot', 'ultrawork'],
};
```

Discord 커맨드로 변환:

```typescript
// /superpowers brainstorming
new SlashCommandBuilder()
  .setName('superpowers')
  .setDescription('Superpowers 스킬')
  .addSubcommand(sub => sub
    .setName('brainstorming')
    .setDescription('브레인스토밍'))
  .addSubcommand(sub => sub
    .setName('writing-plans')
    .setDescription('구현 계획 작성'))
  // ...
```

서브커맨드의 description은 스킬 캐시에서 가져오되, 캐시 초기화 전이면 기본 텍스트 사용.

### `/skill` autocomplete 커맨드

```typescript
new SlashCommandBuilder()
  .setName('skill')
  .setDescription('Claude Code 스킬 실행')
  .addStringOption(opt => opt
    .setName('name')
    .setDescription('스킬 이름')
    .setRequired(true)
    .setAutocomplete(true))
```

### 핸들러

서브커맨드와 `/skill` 모두 동일하게 bridge에 전달:

```typescript
// 서브커맨드: /superpowers brainstorming
const subcommand = interaction.options.getSubcommand();
const namespace = interaction.commandName;  // "superpowers"
bridge.enqueue(`/${namespace}:${subcommand}`, 'system');

// /skill: /skill superpowers:brainstorming
const skillName = interaction.options.getString('name', true);
bridge.enqueue(`/${skillName}`, 'system');
```

## bot/events.ts 변경

`interactionCreate`에 autocomplete 분기 추가:

```typescript
client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction, skillCache);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  // ... 기존 핸들링
});
```

autocomplete 핸들러:

```typescript
async function handleAutocomplete(interaction, skillCache) {
  const query = interaction.options.getFocused();
  const results = skillCache.search(query);
  await interaction.respond(
    results.slice(0, 25).map(s => ({
      name: `${s.fullName} — ${s.description}`.slice(0, 100),
      value: s.fullName,
    }))
  );
}
```

## 초기화 흐름

```
봇 시작
  → SkillCache.initialize() — 스킬 전체 스캔
  → registerCommands() — 기존 커맨드 + 서브커맨드 그룹 + /skill
  → SkillCache.startWatching() — 파일 감시 시작
  → recoverSessions() — 기존 세션 복구

스킬 파일 변경 감지
  → debounce(5초)
  → SkillCache.initialize() 재호출
  → autocomplete 캐시 자동 갱신 (메모리 내)
  → 서브커맨드는 재등록하지 않음 (봇 재시작 시 반영)
```

## 에러 처리

| 상황 | 처리 |
|------|------|
| frontmatter 파싱 실패 | 해당 파일 건너뜀, console.warn |
| 스킬 디렉토리 없음 | 건너뜀 (유저 환경에 따라 없을 수 있음) |
| fs.watch 실패 | console.warn, 감시 없이 운영 (수동 재시작으로 갱신) |
| autocomplete 응답 실패 | 빈 목록 반환 |
| 서브커맨드 등록 실패 | console.error, `/skill`로 폴백 |

## 환경변수

변경 없음. 스킬 경로는 Claude Code 표준 경로를 자동 탐지.

## Graceful Shutdown

기존 shutdown 흐름에 `skillCache.stopWatching()` 추가.
