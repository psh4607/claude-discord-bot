# Claude Code 하네스 기반 리팩토링 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord 봇을 Claude Code 하네스 위의 얇은 Transport Layer로 리팩토링하여, hooks/MCP tools/CLAUDE.md 등 하네스 기능을 최대한 활용한다.

**Architecture:** `query(resume)` 패턴 기반. 봇은 메시지 전달 + Discord MCP 서버 제공만 담당. 세션 관리/컨텍스트/도구 사용은 하네스에 위임.

**Tech Stack:** Node.js 22, TypeScript 5.5, discord.js v14, @anthropic-ai/claude-agent-sdk 0.2.83, tsup, vitest

**Spec:** `docs/superpowers/specs/2026-03-25-v2-sdk-refactor-design.md`

---

### Task 0: SDK 버전 pin + 환경변수 추가

**Files:**
- Modify: `package.json:15` — SDK 버전을 `"latest"` → `"0.2.83"`로 변경
- Modify: `src/config/index.ts` — `CLAUDE_MODEL` 환경변수 추가
- Modify: `src/config/index.test.ts` — 모델 설정 테스트 추가
- Modify: `.env.example` — `CLAUDE_MODEL` 추가

- [ ] **Step 1: package.json에서 SDK 버전 pin**

```json
"@anthropic-ai/claude-agent-sdk": "0.2.83"
```

- [ ] **Step 2: config에 CLAUDE_MODEL 추가**

`src/config/index.ts`:
```typescript
export interface Config {
  discordToken: string;
  categoryName: string;
  requiredRole: string | undefined;
  model: string;
  dataDir: string;
  retentionDays: number;
}

export function loadConfig(): Config {
  return {
    discordToken: requireEnv('DISCORD_TOKEN'),
    requiredRole: process.env.DISCORD_REQUIRED_ROLE,
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    categoryName: process.env.DISCORD_CATEGORY_NAME ?? 'claude',
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    retentionDays: Number(process.env.ARCHIVE_RETENTION_DAYS ?? '30'),
  };
}
```

- [ ] **Step 3: config 테스트 업데이트**

`src/config/index.test.ts`에 모델 기본값 테스트 추가:
```typescript
it('CLAUDE_MODEL 기본값 적용', () => {
  process.env.DISCORD_TOKEN = 'test-token';
  const config = loadConfig();
  expect(config.model).toBe('claude-sonnet-4-6');
});
```

- [ ] **Step 4: .env.example 업데이트**

```
CLAUDE_MODEL=claude-sonnet-4-6
```

- [ ] **Step 5: 테스트 실행 및 커밋**

Run: `pnpm test`
Expected: 모든 테스트 통과

```bash
git add package.json src/config/index.ts src/config/index.test.ts .env.example
git commit -m "chore: SDK 버전 pin 및 CLAUDE_MODEL 환경변수 추가"
```

---

### Task 1: SessionLogger 구현

**Files:**
- Create: `src/session/logger.ts`
- Create: `src/session/logger.test.ts`

- [ ] **Step 1: logger 테스트 작성**

`src/session/logger.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionLogger } from './logger.js';

describe('SessionLogger', () => {
  let tmpDir: string;
  let logger: SessionLogger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'logger-test-'));
    logger = new SessionLogger(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('사용자 메시지를 기록한다', async () => {
    await logger.logUser('완두콩', '안녕하세요');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('👤 완두콩');
    expect(content).toContain('안녕하세요');
  });

  it('Claude 응답을 기록한다', async () => {
    await logger.logAssistant('안녕하세요!');
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('🤖 Claude');
    expect(content).toContain('안녕하세요!');
  });

  it('도구 사용을 기록한다', async () => {
    await logger.logToolUse('Read', { file_path: 'src/index.ts' });
    const content = await readFile(logger.currentLogPath(), 'utf-8');
    expect(content).toContain('Read');
    expect(content).toContain('src/index.ts');
  });

  it('일별 로테이션으로 파일이 생성된다', () => {
    const path = logger.currentLogPath();
    const today = new Date().toISOString().split('T')[0];
    expect(path).toContain(today);
    expect(path).toContain('chat-history');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test src/session/logger.test.ts`
Expected: FAIL — `SessionLogger` 모듈 없음

- [ ] **Step 3: SessionLogger 구현**

`src/session/logger.ts`:
```typescript
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class SessionLogger {
  private chatHistoryDir: string;

  constructor(discordDir: string) {
    this.chatHistoryDir = join(discordDir, 'chat-history');
  }

  currentLogPath(): string {
    const today = new Date().toISOString().split('T')[0];
    return join(this.chatHistoryDir, `${today}.md`);
  }

  async logUser(username: string, message: string): Promise<void> {
    const time = this.timestamp();
    await this.append(`\n### [${time}] 👤 ${username}\n${message}\n`);
  }

  async logAssistant(response: string): Promise<void> {
    const time = this.timestamp();
    const truncated = response.length > 500
      ? response.slice(0, 500) + '\n...(생략)'
      : response;
    await this.append(`\n### [${time}] 🤖 Claude\n${truncated}\n`);
  }

  async logToolUse(toolName: string, input: unknown): Promise<void> {
    const summary = this.summarizeToolInput(toolName, input);
    await this.append(`- 🔧 ${toolName}: ${summary}\n`);
  }

  async logToolResult(toolName: string, success: boolean, error?: string): Promise<void> {
    const icon = success ? '✅' : '❌';
    const suffix = error ? ` — ${error}` : '';
    await this.append(`  ${icon} ${toolName} 완료${suffix}\n`);
  }

  async logError(error: string): Promise<void> {
    const time = this.timestamp();
    await this.append(`\n### [${time}] ❌ 오류\n${error}\n`);
  }

  private async append(content: string): Promise<void> {
    await mkdir(this.chatHistoryDir, { recursive: true });
    await appendFile(this.currentLogPath(), content, 'utf-8');
  }

  private timestamp(): string {
    return new Date().toTimeString().split(' ')[0];
  }

  private summarizeToolInput(name: string, input: unknown): string {
    const i = input as Record<string, unknown>;
    switch (name) {
      case 'Read': return String(i.file_path ?? '');
      case 'Edit': return String(i.file_path ?? '');
      case 'Write': return String(i.file_path ?? '');
      case 'Bash': return String(i.description ?? i.command ?? '');
      case 'Grep': return `"${i.pattern}" in ${i.path ?? '.'}`;
      case 'Glob': return String(i.pattern ?? '');
      default: return JSON.stringify(input).slice(0, 80);
    }
  }
}
```

- [ ] **Step 4: 테스트 실행**

Run: `pnpm test src/session/logger.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/session/logger.ts src/session/logger.test.ts
git commit -m "feat: SessionLogger 구현 (chat-history 일별 로그)"
```

---

### Task 2: Workspace 리팩토링 (.discord/ 디렉토리)

**Files:**
- Modify: `src/session/workspace.ts` — `.discord/` 초기화 + session.json 경로 변경 + 마이그레이션
- Modify: `src/session/workspace.test.ts` — 테스트 업데이트

- [ ] **Step 1: workspace 테스트 업데이트**

`.discord/` 디렉토리 생성, session.json 신규 경로, 구 경로 마이그레이션 테스트 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/session/workspace.test.ts`
Expected: FAIL

- [ ] **Step 3: workspace.ts 수정**

주요 변경:
- `create()` 시 `.discord/chat-history/` 디렉토리 생성
- `saveSessionId()` / `loadSessionId()` 경로를 `.discord/session.json`으로 변경
- `loadSessionId()`에 구 경로 폴백 + 자동 마이그레이션 추가
- 기본 `CLAUDE.md` 템플릿 생성

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/session/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/session/workspace.ts src/session/workspace.test.ts
git commit -m "refactor: workspace에 .discord/ 디렉토리 구조 적용"
```

---

### Task 3: MessageSender에 appendStatusLog 메서드 추가

**Files:**
- Modify: `src/message/sender.ts` — `appendStatusLog()` 메서드 추가

- [ ] **Step 1: sender.ts에 appendStatusLog 추가**

기존 `sendStatusUpdate()`는 메시지를 edit하여 덮어쓰는 방식. 새 `appendStatusLog()`는 로그 라인을 누적하다가 최종 요약으로 확정하는 방식.

```typescript
private statusLogs = new Map<string, { message: Message; lines: string[]; startTime: number }>();

async appendStatusLog(channel: TextChannel, line: string): Promise<void> {
  const entry = this.statusLogs.get(channel.id);
  if (entry) {
    entry.lines.push(line);
    const content = this.formatStatusLog(entry.lines);
    await entry.message.edit(content).catch(() => {});
  } else {
    const msg = await channel.send(this.formatStatusLog([line]));
    this.statusLogs.set(channel.id, { message: msg, lines: [line], startTime: Date.now() });
  }
}

async finalizeStatusLog(channelId: string): Promise<void> {
  const entry = this.statusLogs.get(channelId);
  if (!entry) return;
  const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(1);
  const summary = `${entry.lines.length}개 도구 사용 · ${elapsed}초 소요`;
  const content = this.formatStatusLog(entry.lines, summary);
  await entry.message.edit(content).catch(() => {});
  this.statusLogs.delete(channelId);
}

private formatStatusLog(lines: string[], summary?: string): string {
  const body = lines.map(l => `│ ${l}`).join('\n');
  const footer = summary ? `└ ${summary}` : `└ 처리 중...`;
  return `┌ 실행 로그\n${body}\n${footer}`;
}
```

- [ ] **Step 2: cleanup()에 statusLogs 정리 추가**

- [ ] **Step 3: 테스트 실행**

Run: `pnpm test`
Expected: 기존 테스트 모두 통과

- [ ] **Step 4: 커밋**

```bash
git add src/message/sender.ts
git commit -m "feat: MessageSender에 누적 실행 로그 기능 추가"
```

---

### Task 4: Discord MCP 서버 구현

**Files:**
- Create: `src/tools/discord-mcp.ts`
- Create: `src/tools/discord-mcp.test.ts`

- [ ] **Step 1: 테스트 작성**

Discord Client를 모킹하여 MCP 서버의 tool 핸들러를 테스트. `list_channels`, `send_message` 등 주요 도구의 입출력 검증.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/tools/discord-mcp.test.ts`
Expected: FAIL

- [ ] **Step 3: discord-mcp.ts 구현**

`createSdkMcpServer()` + `tool()`로 13개 Discord 도구 정의:
- 안전: `list_channels`, `set_channel_topic`, `read_messages`, `create_thread`, `add_reaction`, `pin_message`, `list_members`, `get_member_info`
- 주의: `send_message`, `create_channel` (카테고리 제한)
- 위험: `delete_channel`, `assign_role`, `remove_role` (카테고리/화이트리스트 제한)

보안 가드를 각 도구에 적용.

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test src/tools/discord-mcp.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/tools/discord-mcp.ts src/tools/discord-mcp.test.ts
git commit -m "feat: Discord MCP 서버 구현 (13개 도구 + 보안 가드)"
```

---

### Task 5: Hooks 팩토리 구현

**Files:**
- Create: `src/session/hooks.ts`
- Create: `src/session/hooks.test.ts`

- [ ] **Step 1: hooks 테스트 작성**

`createHooks()`가 올바른 `HookCallbackMatcher` 구조를 반환하는지, `toolLabel()`이 각 도구별 라벨을 정확히 생성하는지 테스트.

- [ ] **Step 2: 테스트 실패 확인**

- [ ] **Step 3: hooks.ts 구현**

`createHooks()`: PreToolUse, PostToolUse, PostToolUseFailure 훅 정의.
`toolLabel()`: Read, Edit, Write, Bash, Grep, Glob, Agent 등 도구별 라벨.
`truncate()`: 긴 문자열 잘라내기 유틸.

- [ ] **Step 4: 테스트 통과**

- [ ] **Step 5: 커밋**

```bash
git add src/session/hooks.ts src/session/hooks.test.ts
git commit -m "feat: hooks 팩토리 구현 (실시간 도구 피드백)"
```

---

### Task 6: Session Options 팩토리 구현

**Files:**
- Create: `src/session/options.ts`

- [ ] **Step 1: options.ts 구현**

`createQueryOptions()`: config, client, channel, sender, logger를 받아 `query()` 옵션 객체를 조립. `cwd`와 `resume`은 제외 (bridge에서 동적 추가).

```typescript
import type { Client, TextChannel } from 'discord.js';
import type { Config } from '../config/index.js';
import type { MessageSender } from '../message/sender.js';
import type { SessionLogger } from './logger.js';
import { createDiscordMcpServer } from '../tools/discord-mcp.js';
import { createHooks } from './hooks.js';

export function createQueryOptions(
  config: Config,
  client: Client,
  channel: TextChannel,
  sender: MessageSender,
  logger: SessionLogger,
) {
  return {
    model: config.model,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    mcpServers: { discord: createDiscordMcpServer(client, channel, config) },
    hooks: createHooks(channel, sender, logger),
  };
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/session/options.ts
git commit -m "feat: session options 팩토리 구현"
```

---

### Task 7: SessionBridge 구현

**Files:**
- Create: `src/session/bridge.ts`
- Create: `src/session/bridge.test.ts`

- [ ] **Step 1: bridge 테스트 작성**

큐 직렬화, sessionId 캡처, abort, resume 폴백 등 핵심 동작 테스트. `query()`를 모킹.

- [ ] **Step 2: 테스트 실패 확인**

- [ ] **Step 3: bridge.ts 구현**

스펙의 `SessionBridge` 클래스 구현:
- `enqueue()` → 큐에 추가 + `processQueue()` 트리거
- `processQueue()` → 직렬 처리
- `processMessage()` → `query({ prompt, options: { cwd, resume, ... } })` + 스트림 처리
- `abort()` → `activeQuery.close()`
- `resetSession()` → sessionId 초기화
- resume 실패 시 sessionId 리셋 + 재시도

- [ ] **Step 4: 테스트 통과**

- [ ] **Step 5: 커밋**

```bash
git add src/session/bridge.ts src/session/bridge.test.ts
git commit -m "feat: SessionBridge 구현 (query/resume + 메시지 큐)"
```

---

### Task 8: SessionPool 구현

**Files:**
- Create: `src/session/pool.ts`
- Create: `src/session/pool.test.ts`

- [ ] **Step 1: pool 테스트 작성**

`create()`, `get()`, `restore()`, `close()`, `shutdown()` 테스트.

- [ ] **Step 2: 테스트 실패 확인**

- [ ] **Step 3: pool.ts 구현**

```typescript
export class SessionPool {
  private bridges = new Map<string, SessionBridge>();

  async create(channelId, channel, workspace, config, client, sender): Promise<SessionBridge>
  get(channelId): SessionBridge | undefined
  has(channelId): boolean
  async restore(channelId, channel, workspace, config, client, sender): Promise<SessionBridge>
  async close(channelId, channelName?): Promise<ArchiveResult | null>
  shutdown(): void
}
```

- [ ] **Step 4: 테스트 통과**

- [ ] **Step 5: 커밋**

```bash
git add src/session/pool.ts src/session/pool.test.ts
git commit -m "feat: SessionPool 구현 (채널별 세션 관리)"
```

---

### Task 9: Events 리팩토링

**Files:**
- Modify: `src/bot/events.ts` — `SessionManager` → `SessionPool` + `SessionBridge` 연동

- [ ] **Step 1: events.ts 수정**

`SessionManager` 의존성을 `SessionPool`로 변경:
- `channelCreate` → `pool.create()` + 환영 메시지
- `channelDelete` → `pool.close()`
- `messageCreate` → `pool.get()` → `bridge.enqueue(message, username)`
- `ready` → `recoverSessions()` 에서 `pool.restore()` 사용

- [ ] **Step 2: 테스트 실행**

Run: `pnpm test`
Expected: PASS (guards 테스트는 변경 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/bot/events.ts
git commit -m "refactor: events에서 SessionPool/Bridge 사용"
```

---

### Task 10: Discord 슬래시 커맨드

**Files:**
- Create: `src/bot/commands.ts`
- Modify: `src/bot/client.ts` — Interaction 관련 설정 추가

- [ ] **Step 1: client.ts에 Interaction 지원 추가**

필요 시 `GatewayIntentBits` 추가 확인 (슬래시 커맨드는 별도 intent 불필요).

- [ ] **Step 2: commands.ts 구현**

`registerCommands()`: 봇 ready 시 guild 커맨드 1회 등록.
`handleInteraction()`: 커맨드별 핸들러 라우팅.

커맨드 목록: `/stop`, `/status`, `/new`, `/history`, `/instructions`, `/compact`, `/model`

- [ ] **Step 3: events.ts에 interactionCreate 이벤트 추가**

- [ ] **Step 4: 커밋**

```bash
git add src/bot/commands.ts src/bot/client.ts src/bot/events.ts
git commit -m "feat: Discord 슬래시 커맨드 구현 (7개)"
```

---

### Task 11: 진입점 업데이트 + 기존 모듈 정리

**Files:**
- Modify: `src/index.ts` — 새 모듈 연결
- Delete: `src/session/manager.ts` — SessionPool/Bridge로 대체됨

- [ ] **Step 1: index.ts 수정**

```typescript
import { loadConfig } from './config/index.js';
import { createClient } from './bot/client.js';
import { registerEvents } from './bot/events.js';
import { SessionPool } from './session/pool.js';
import { Workspace } from './session/workspace.js';
import { MessageSender } from './message/sender.js';
import { scheduleRetention } from './storage/retention.js';

async function main() {
  const config = loadConfig();
  const workspace = new Workspace(config.dataDir);
  const sender = new MessageSender();
  const pool = new SessionPool(workspace, sender);
  const client = createClient();

  registerEvents(client, pool, config);

  const retentionTimer = scheduleRetention(
    workspace.paths.archives,
    workspace.paths.longTerm,
    config.retentionDays,
  );

  // ... shutdown, signals (기존과 동일)
}
```

- [ ] **Step 2: session/manager.ts 삭제**

```bash
rm src/session/manager.ts
```

- [ ] **Step 3: 빌드 + 테스트**

Run: `pnpm build && pnpm test`
Expected: 빌드 성공, 테스트 통과

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "refactor: 진입점 업데이트 및 기존 SessionManager 제거"
```

---

### Task 12: CLAUDE.md 업데이트 + 배포

**Files:**
- Modify: `CLAUDE.md` — 새 디렉토리 구조, 환경변수 반영
- Modify: `.env.example` — 최종 확인

- [ ] **Step 1: CLAUDE.md 업데이트**

디렉토리 구조, 환경변수 테이블, 모듈 설명을 새 아키텍처에 맞게 수정.
`ANTHROPIC_API_KEY` 행 제거.

- [ ] **Step 2: dalpha-mac .env 업데이트**

```bash
ssh dalpha-mac 'echo "CLAUDE_MODEL=claude-sonnet-4-6" >> ~/projects/seongho/projects/claude-discord-bot/.env'
```

- [ ] **Step 3: dalpha-mac 배포**

```bash
ssh dalpha-mac 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/projects/seongho/projects/claude-discord-bot && git pull && pnpm install && pnpm build && pm2 restart claude-discord-bot'
```

- [ ] **Step 4: 로그 확인**

```bash
ssh dalpha-mac 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && pm2 logs claude-discord-bot --lines 10 --nostream'
```
Expected: `봇 로그인 완료` 로그 확인

- [ ] **Step 5: Discord에서 수동 테스트**

채널 생성 → 메시지 전송 → 실행 로그 확인 → 슬래시 커맨드 → 채널 삭제

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "docs: CLAUDE.md 및 환경변수를 새 아키텍처에 맞게 업데이트"
git push origin main
```
