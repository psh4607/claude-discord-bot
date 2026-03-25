# Claude Code 하네스 기반 리팩토링 설계 문서

Discord 봇을 Claude Agent SDK의 `query()` API + 하네스 기능(hooks, MCP tools, cwd, resume)을 최대한 활용하는 얇은 Transport Layer로 재설계한다.

> **v2 `SDKSession` 대신 `query(resume)` 패턴을 사용하는 이유:**
> v2 `SDKSessionOptions`에는 `cwd`, `mcpServers`, `tools` 필드가 없다. 반면 `query()` 옵션은 이 모든 것을 지원한다. 하네스에 올라타려면 `query()` API가 현시점에서 더 적합하다. v2 API가 안정화되면 전환을 재검토한다.

## 핵심 원칙

**봇은 3가지만 한다:**
1. Discord 이벤트를 Claude Code 세션으로 전달
2. Claude Code 세션의 응답을 Discord로 전달
3. Claude에게 Discord API를 MCP 서버로 제공

나머지(컨텍스트 관리, compact, 도구 사용, 세션 영속성)는 전부 Claude Code 하네스가 처리한다.

## 아키텍처

### Transport Layer 패턴

```
Discord ←→ Transport Layer ←→ Claude Code (query API)
            (봇: ~400줄)         (하네스가 전부 처리)
```

### 디렉토리 구조

```
src/
  index.ts              # 진입점 (봇 초기화 + 세션 옵션 구성)
  bot/
    client.ts           # Discord.js 클라이언트 (기존 유지)
    events.ts           # 이벤트 핸들러 (bridge에 위임)
    guards.ts           # 역할/카테고리 검증 (기존 유지)
    commands.ts         # Discord 슬래시 커맨드 등록 및 핸들링
  session/
    bridge.ts           # query(resume) 래퍼 + 메시지 큐 + Discord 연동
    pool.ts             # 채널별 세션 풀 관리 (create/get/close)
    options.ts          # query() Options 팩토리 (hooks, MCP, 모델 등)
    logger.ts           # chat-history 로거
  tools/
    discord-mcp.ts      # Discord MCP 서버 (createSdkMcpServer 기반)
  message/
    formatter.ts        # 기존 유지
    sender.ts           # 기존 유지 (hooks에서도 재사용)
  storage/
    archive.ts          # 기존 유지
    retention.ts        # 기존 유지
  config/
    index.ts            # 환경변수 (모델명 등 추가)
```

### 변경 요약

| 모듈 | 변경 |
|------|------|
| `session/manager.ts` (227줄) | 삭제 → `bridge.ts` + `pool.ts`로 대체 |
| `session/workspace.ts` | 단순화 — 디렉토리 생성 + `.discord/` 초기화만 담당 |
| `storage/archive.ts`, `retention.ts` | 유지 |
| `bot/events.ts` | 단순화 — bridge에 위임 |
| `tools/discord-mcp.ts` | 신규 — `createSdkMcpServer()` 기반 Discord MCP 서버 |
| `bot/commands.ts` | 신규 — 슬래시 커맨드 |
| `session/options.ts` | 신규 — query() 옵션 조립 |
| `session/logger.ts` | 신규 — chat-history 기록 |

## Session Bridge

### session/bridge.ts — 세션 1개의 생명주기

하나의 Discord 채널과 하나의 Claude Code 세션을 연결하는 래퍼. `query(resume)` 패턴으로 세션을 이어간다.

```typescript
class SessionBridge {
  private sessionId: string = '';
  private activeQuery: Query | null = null;
  private queue: QueueItem[] = [];
  private processing = false;

  constructor(
    private channelId: string,
    private channel: TextChannel,
    private workspacePath: string,
    private sender: MessageSender,
    private logger: SessionLogger,
    private options: Options,
  ) {}

  // 메시지 큐에 추가 + 직렬 처리
  enqueue(prompt: string, username: string): void {
    this.queue.push({ prompt, username });
    if (!this.processing) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      await this.processMessage(item);
    }
    this.processing = false;
  }

  private async processMessage(item: QueueItem): Promise<void> {
    this.logger.logUser(item.username, item.prompt);

    const result = query({
      prompt: item.prompt,
      options: {
        ...this.options,
        cwd: this.workspacePath,
        ...(this.sessionId ? { resume: this.sessionId } : {}),
      },
    });
    this.activeQuery = result;

    for await (const msg of result) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        this.sessionId = msg.session_id;
        await this.saveSessionId();
        this.logger.logAssistant(msg.result);
        await this.sender.sendResponse(this.channel, formatResponse(msg.result));
      } else if (msg.type === 'result' && msg.subtype === 'error') {
        const errorMsg = msg.error ?? '알 수 없는 오류';
        this.logger.logError(errorMsg);
        await this.channel.send(`오류가 발생했습니다: ${errorMsg}`).catch(() => {});
      } else if (msg.type === 'system' && msg.subtype === 'rate_limit') {
        const wait = msg.seconds_remaining ?? 60;
        await this.channel.send(`API 제한에 도달했습니다. ${wait}초 후 재시도합니다.`).catch(() => {});
      }
    }

    this.activeQuery = null;
  }

  abort(): void {
    this.activeQuery?.close();
    this.activeQuery = null;
  }
}
```

### 현재 SessionManager vs Bridge 비교

| 현재 (직접 구현) | Bridge (하네스 활용) |
|----------------|-------------------|
| 세션 ID 추적 + session.json 영속화 | 동일하게 추적하되, hooks/MCP 등 하네스 기능을 옵션으로 주입 |
| 메시지 큐 + 동시성 제어 | 메시지 큐 유지 (명시적 직렬화) |
| resume 옵션으로 세션 이어가기 | `query({ resume: sessionId })` — 동일 패턴 |
| resume 실패 시 새 세션 폴백 | 동일 — sessionId 초기화 후 재시도 |
| 하네스 기능 미활용 | hooks, MCP tools, 채널별 CLAUDE.md 활용 |

### session/pool.ts — 채널별 세션 관리

```typescript
class SessionPool {
  private bridges = new Map<string, SessionBridge>();

  create(channelId, channel, options) → SessionBridge
  get(channelId) → SessionBridge | undefined
  restore(channelId) → sessionId 복원 후 SessionBridge 생성
  close(channelId) → abort + archive 후 제거
  shutdown() → 전체 abort + 정리
}
```

### session/options.ts — query() 옵션 팩토리

```typescript
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

function createQueryOptions(config, channel, client, sender, logger): Options {
  const discordMcp = createDiscordMcpServer(client, channel);

  return {
    model: config.model,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    mcpServers: { discord: discordMcp },
    hooks: createHooks(channel, sender, logger),
  };
}
```

`cwd`, `resume`은 bridge에서 호출 시 동적으로 추가한다.

## Custom Tools — Discord MCP 서버

### tools/discord-mcp.ts

`createSdkMcpServer()`로 Discord 기능을 MCP 서버로 노출한다. `query()` 옵션의 `mcpServers`에 전달하면 Claude가 도구로 사용할 수 있다.

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

function createDiscordMcpServer(client: Client, currentChannel: TextChannel) {
  return createSdkMcpServer({
    name: 'discord',
    tools: [
      tool('send_message', '특정 Discord 채널에 메시지를 전송합니다',
        { channelId: z.string(), content: z.string() },
        async ({ channelId, content }) => {
          const ch = await client.channels.fetch(channelId);
          if (!ch?.isTextBased()) {
            return { content: [{ type: 'text', text: '텍스트 채널이 아닙니다' }], isError: true };
          }
          await ch.send(content);
          return { content: [{ type: 'text', text: '전송 완료' }] };
        }
      ),
      // ... 나머지 tools
    ],
  });
}
```

### 도구 목록 및 보안 등급

| Tool | 설명 | 보안 등급 |
|------|------|---------|
| **채널 관리** | | |
| `list_channels` | 서버 채널 목록 조회 | 안전 |
| `create_channel` | 채널 생성 | 주의 — claude 카테고리 내로 제한 |
| `delete_channel` | 채널 삭제 | 위험 — claude 카테고리 내 + 확인 메시지 |
| `set_channel_topic` | 채널 토픽 변경 | 안전 |
| **메시지** | | |
| `send_message` | 특정 채널에 메시지 전송 | 주의 — claude 카테고리 내로 제한 |
| `read_messages` | 최근 메시지 읽기 | 안전 |
| `create_thread` | 스레드 생성 | 안전 |
| `add_reaction` | 리액션 추가 | 안전 |
| `pin_message` | 메시지 고정 | 안전 |
| **서버 관리** | | |
| `list_members` | 멤버 목록 조회 | 안전 |
| `get_member_info` | 멤버 정보 조회 | 안전 |
| `assign_role` | 역할 부여 | 위험 — 허용 역할 화이트리스트 필요 |
| `remove_role` | 역할 제거 | 위험 — 허용 역할 화이트리스트 필요 |

### 보안 정책

- **안전**: 제한 없이 실행
- **주의**: claude 카테고리 내 채널로 대상 제한
- **위험**: 실행 전 Discord 메시지로 사용자에게 확인 요청, 또는 화이트리스트 기반 제한

```typescript
// 위험 도구의 확인 패턴 예시
tool('delete_channel', '...', schema, async ({ channelId }) => {
  const ch = await client.channels.fetch(channelId);
  if (!isClaudeCategory(ch, config.categoryName)) {
    return error('claude 카테고리 내 채널만 삭제할 수 있습니다');
  }
  // 실행
});
```

## Hooks — 실시간 Discord 피드백

### 누적 로그 방식

도구 사용 기록을 삭제하지 않고 실행 로그로 남긴다:

```
┌ 실행 로그 ─────────────────────
│ 📖 src/bot/events.ts (1~50줄) 읽음
│ 🔎 "SDKSession" in src/ 검색
│ ✏️ src/session/bridge.ts 수정
│ ⚡ `pnpm test` → ✅ 18 passed
└ 4개 도구 사용 · 8초 소요
```

하나의 메시지를 누적 edit하다가, 완료 시 최종 요약으로 확정한다.

### 구현 방식

`query()` 옵션의 `hooks` 필드에 전달한다. SDK의 `HookCallbackMatcher` 구조를 따른다.

```typescript
function createHooks(channel: TextChannel, sender: MessageSender, logger: SessionLogger) {
  return {
    PreToolUse: [{
      hooks: [async (input: HookInput, _toolUseId, _opts) => {
        if (input.hook_event_name !== 'PreToolUse') return {};
        const label = toolLabel(input.tool_name, input.tool_input);
        await sender.appendStatusLog(channel, label);
        logger.logToolUse(input.tool_name, input.tool_input);
        return {};
      }],
    }],
    PostToolUse: [{
      hooks: [async (input: HookInput) => {
        if (input.hook_event_name !== 'PostToolUse') return {};
        logger.logToolResult(input.tool_name, true);
        return {};
      }],
    }],
    PostToolUseFailure: [{
      hooks: [async (input: HookInput) => {
        if (input.hook_event_name !== 'PostToolUseFailure') return {};
        logger.logToolResult(input.tool_name, false, input.error);
        return {};
      }],
    }],
  };
}

function toolLabel(name: string, input: unknown): string {
  const labels: Record<string, (i: any) => string> = {
    Read:  (i) => `📖 ${basename(i.file_path)}${i.offset ? ` (${i.offset}~${i.offset + (i.limit ?? 2000)}줄)` : ''} 읽는 중...`,
    Edit:  (i) => `✏️ ${basename(i.file_path)} 수정 중...`,
    Write: (i) => `📝 ${basename(i.file_path)} 작성 중...`,
    Bash:  (i) => `⚡ \`${i.description ?? truncate(i.command, 40)}\` 실행 중...`,
    Grep:  (i) => `🔎 "${truncate(i.pattern, 30)}" ${i.path ? `in ${basename(i.path)}` : ''} 검색 중...`,
    Glob:  (i) => `🔍 ${i.pattern} 탐색 중...`,
    Agent: ()  => `🤖 서브에이전트 실행 중...`,
  };
  return labels[name]?.(input) ?? `🔧 ${name} 실행 중...`;
}
```

## Discord 슬래시 커맨드

### 등록 전략

Discord Application Commands는 rate limit이 있으므로 (guild 커맨드: 분당 5회), **봇 `ready` 이벤트에서 1회만 등록**한다. 등록 내용이 변경되지 않았으면 호출을 건너뛴다 (해시 비교).

### 2계층 구조

**Claude Code 명령어 (초기 query에서 조회):**

봇 시작 시 첫 `query()` 호출의 결과에서 지원 명령어를 확인할 수 있다. 이 정보를 캐시하여 Discord 슬래시 커맨드로 등록한다.

```typescript
// 봇 ready 시 1회 실행
async function registerCommands(guild: Guild, config: Config) {
  const commands = [
    // 봇 전용 커맨드
    ...botCommands,
    // Claude Code 명령어를 사용자 메시지로 전달하는 패턴
    { name: 'compact', description: '세션 컨텍스트 압축' },
    { name: 'model', description: '세션 모델 변경', options: [modelOption] },
  ];

  await guild.commands.set(commands);
}

// 슬래시 커맨드 핸들러 — Claude Code 명령어는 bridge를 통해 전달
async function handleCommand(interaction, pool) {
  const bridge = pool.get(interaction.channelId);
  if (interaction.commandName === 'compact') {
    bridge.enqueue('/compact', 'system');
  } else if (interaction.commandName === 'stop') {
    bridge.abort();
  }
  // ...
}
```

**봇 전용 커맨드 (직접 정의):**

| 커맨드 | 설명 |
|--------|------|
| `/stop` | 현재 실행 중단 (Query.close()) |
| `/status` | 세션 상태 확인 (sessionId, 모델 등) |
| `/new` | 세션 초기화 (sessionId 리셋) |
| `/history` | 대화 로그 조회 (chat-history 활용) |
| `/instructions <text>` | 채널 CLAUDE.md 수정 |
| `/compact` | 수동 컨텍스트 압축 |
| `/model <name>` | 세션 모델 변경 |

## 워크스페이스 구조 & 활동 로그

### `.discord/` 디렉토리

```
data/workspaces/{channelId}/
  .discord/
    session.json              # 세션 메타 (ID, 채널명, 생성일시)
    chat-history/
      2026-03-25.md           # 일별 대화 + 도구 사용 통합 로그
      2026-03-26.md
  CLAUDE.md                   # 채널별 행동 지시 (선택)
  ... (Claude가 작업하는 파일들)
```

### session/logger.ts — 활동 로그 기록

```typescript
class SessionLogger {
  logUser(username: string, message: string): void
    // chat-history/YYYY-MM-DD.md에 ### [HH:MM:SS] 👤 username 추가

  logAssistant(response: string): void
    // ### [HH:MM:SS] 🤖 Claude 추가

  logToolUse(toolName: string, input: unknown): void
    // 실행 로그에 도구 사용 기록 추가

  logToolResult(toolName: string, success: boolean, error?: string): void
    // 도구 결과 (✅/❌) 업데이트
}
```

모든 기록은 `appendFile`로 순차 추가되므로 동시 쓰기 충돌이 없다 (bridge의 큐가 직렬화를 보장).

### 로그 로테이션

일별 로테이션: `chat-history/YYYY-MM-DD.md` 파일로 자동 분리. 아카이브 시 `.discord/` 디렉토리가 그대로 보존된다.

## CLAUDE.md — 채널별 행동 커스터마이징

각 채널의 워크스페이스에 `CLAUDE.md`를 두면 채널별로 Claude의 행동을 선언적으로 제어할 수 있다. Claude Code 하네스가 `cwd` 기준으로 자동 로드하므로 봇이 할 일이 없다.

채널 생성 시 기본 템플릿을 자동 생성하고, `/instructions` 슬래시 커맨드로 수정할 수 있다.

## 에러 처리

| 상황 | 처리 |
|------|------|
| `query()` 스트리밍 에러 | catch → Discord에 에러 메시지 + chat-history에 기록 |
| resume 실패 (세션 만료) | sessionId 초기화 → 새 세션으로 재시도 → "새 세션으로 시작합니다" 안내 |
| Discord API 에러 | discord.js 내장 핸들링 의존 |
| Rate limit (`SDKRateLimitEvent`) | 스트림에서 감지 → Discord에 대기 시간 안내 |
| 봇 재시작 후 복구 | 채널 스캔 → `.discord/session.json`에서 ID 로드 → `query({ resume })` |
| MCP 서버 오류 | hooks로 Discord에 알림, 세션은 유지 |

## Graceful Shutdown

```typescript
const shutdown = async () => {
  console.log('종료 시작...');
  pool.shutdown();     // 모든 bridge.abort() + 큐 클리어
  sender.cleanup();    // 타이핑 인디케이터 정리
  client.destroy();    // Discord 연결 종료
  console.log('종료 완료');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

shutdown 순서: pool이 먼저 모든 세션을 정리하고, sender가 타이핑을 정리하고, 마지막에 Discord 연결을 종료한다.

## 환경변수

| 변수 | 설명 | 변경 |
|------|------|------|
| `DISCORD_TOKEN` | Discord 봇 토큰 | 유지 |
| `DISCORD_CATEGORY_NAME` | 관리할 카테고리명 (기본: claude) | 유지 |
| `DISCORD_REQUIRED_ROLE` | 봇 사용 역할 (미설정 시 전체 허용) | 유지 |
| `DATA_DIR` | 데이터 저장 경로 (기본: ./data) | 유지 |
| `ARCHIVE_RETENTION_DAYS` | 아카이브 보존 기간 (기본: 30) | 유지 |
| `CLAUDE_MODEL` | 세션 모델 (기본: claude-sonnet-4-6) | 신규 |

> `ANTHROPIC_API_KEY`는 불필요. claude-agent-sdk는 로컬 Claude Code CLI의 인증을 사용한다.

## SDK 버전 관리

- 구현 첫 단계로 `package.json`에서 SDK 버전을 pin한다 (`"@anthropic-ai/claude-agent-sdk": "0.2.83"`)
- 현재 `"latest"`로 되어 있으므로 반드시 변경 필요
- 업데이트는 수동으로 테스트 후 적용 (자동 업데이트는 백로그: `.claude/backlog/2026-03-25-auto-update-sdk.md`)

## 마이그레이션

### session.json 경로 변경

기존: `data/workspaces/{channelId}/session.json`
신규: `data/workspaces/{channelId}/.discord/session.json`

workspace 모듈에서 sessionId 로드 시 구 경로 폴백을 포함한다:

```typescript
async loadSessionId(channelId: string): Promise<string | null> {
  // 신규 경로 먼저 시도
  const newPath = join(this.workspacesDir, channelId, '.discord', 'session.json');
  if (existsSync(newPath)) return readJson(newPath);

  // 구 경로 폴백
  const oldPath = join(this.workspacesDir, channelId, 'session.json');
  if (existsSync(oldPath)) {
    const data = await readJson(oldPath);
    // 신규 경로로 마이그레이션
    await mkdir(dirname(newPath), { recursive: true });
    await writeJson(newPath, data);
    await unlink(oldPath);
    return data;
  }

  return null;
}
```

## 데이터 흐름

```
채널 생성 (claude 카테고리)
  → guards: 카테고리 확인
  → pool.create(): workspace 디렉토리 생성 + .discord/ 초기화 + CLAUDE.md 템플릿
  → query({ prompt: '환영', options: { cwd, mcpServers, hooks } })
  → sessionId 캡처 → .discord/session.json 저장
  → 채널에 환영 메시지 전송

메시지 수신
  → guards: 카테고리/역할 확인
  → bridge.enqueue(prompt, username)
  → 큐 순차 처리:
    → logger: 사용자 메시지 기록
    → query({ prompt, options: { cwd, resume, mcpServers, hooks } })
    → hooks: Discord에 도구 사용 실시간 표시 + chat-history에 기록
    → result: formatter → sender로 응답 전송 + chat-history에 기록

슬래시 커맨드
  → Claude Code 명령어 (/compact 등): bridge.enqueue('/compact', 'system')
  → 봇 전용 (/stop): bridge.abort()
  → 봇 전용 (/new): bridge.resetSession()
  → 봇 전용 (/instructions): CLAUDE.md 직접 수정

채널 삭제
  → pool.close(): bridge.abort() → archive → Map 제거

봇 재시작
  → claude 카테고리 채널 스캔
  → .discord/session.json에서 sessionId 복원
  → pool.restore()로 bridge 재생성 (다음 메시지에서 resume)
  → 채널에 "세션이 재연결되었습니다" 알림

봇 종료 (SIGTERM/SIGINT)
  → pool.shutdown(): 모든 bridge.abort() + 큐 클리어
  → sender.cleanup(): 타이핑 정리
  → client.destroy(): Discord 연결 종료
```

## v2 API 전환 계획

현재 설계는 `query()` API 기반이다. 향후 v2 `SDKSession`이 안정화되어 다음 조건이 충족되면 전환을 재검토한다:

- `SDKSessionOptions`에 `cwd` 지원 추가
- `SDKSessionOptions`에 `mcpServers` 또는 custom tools 전달 지원
- `unstable_` 접두사 제거

전환 시 영향 범위: `session/bridge.ts`와 `session/options.ts`만 변경. 나머지 모듈(events, commands, tools, hooks, logger)은 그대로 유지된다.
