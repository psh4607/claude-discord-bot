# claude-discord-bot

Discord 채널과 Claude Code 세션을 1:1 매핑하는 봇.
Claude Code 하네스 위의 얇은 Transport Layer로, hooks/MCP tools/CLAUDE.md 등 하네스 기능을 활용한다.

## 기술 스택

- **런타임**: Node.js 22, TypeScript 5.5
- **Discord**: discord.js v14
- **AI**: @anthropic-ai/claude-agent-sdk 0.2.83 (버전 pin)
- **유효성 검사**: Zod
- **빌드**: tsup (ESM)
- **테스트**: Vitest

## 디렉토리 구조

```
src/
  index.ts              # 진입점
  bot/
    client.ts           # Discord.js 클라이언트
    events.ts           # 이벤트 핸들러 (channelCreate/Delete, messageCreate, interactionCreate)
    guards.ts           # 역할/카테고리 검증
    commands.ts         # Discord 슬래시 커맨드 (7개)
  session/
    bridge.ts           # query(resume) 래퍼 + 메시지 큐
    pool.ts             # 채널별 세션 풀 관리
    options.ts          # query() Options 팩토리
    hooks.ts            # 실시간 도구 피드백 hooks
    logger.ts           # chat-history 로거
    workspace.ts        # 워크스페이스 디렉토리 관리
  tools/
    discord-mcp.ts      # Discord MCP 서버 (13개 도구)
  message/
    formatter.ts        # 마크다운 변환, 메시지 분할
    sender.ts           # 메시지/파일 전송, 실행 로그
  storage/
    archive.ts          # 채널 삭제 시 아카이브
    retention.ts        # 30일 후 장기보관 이동
  config/
    index.ts            # 환경변수, 설정값
data/                   # 세션 데이터 영구 저장소 (gitignore)
  workspaces/{channelId}/
    .discord/           # 봇 메타데이터
      session.json      # 세션 ID
      chat-history/     # 일별 대화 로그
    CLAUDE.md           # 채널별 행동 지시
dist/                   # 빌드 결과물 (gitignore)
docs/                   # 설계 문서
```

## 환경 변수

`.env.example`을 복사하여 `.env`를 생성하고 값을 채운다:

| 변수                     | 설명                                            |
| ------------------------ | ----------------------------------------------- |
| `DISCORD_TOKEN`          | Discord 봇 토큰                                 |
| `DISCORD_CATEGORY_NAME`  | 봇이 관리할 채널 카테고리 이름 (기본값: claude) |
| `DISCORD_REQUIRED_ROLE`  | 봇 사용 가능 역할 (미설정 시 전체 허용)         |
| `CLAUDE_MODEL`           | 세션 모델 (기본값: claude-sonnet-4-6)           |
| `DATA_DIR`               | 세션 데이터 저장 경로 (기본값: ./data)          |
| `ARCHIVE_RETENTION_DAYS` | 아카이브 보존 기간 (기본값: 30)                 |

> `ANTHROPIC_API_KEY`는 불필요. claude-agent-sdk는 로컬 Claude Code CLI 인증을 사용한다.

## 빌드 및 실행

```bash
# 의존성 설치
pnpm install

# 개발 모드 (watch)
pnpm dev

# 프로덕션 빌드
pnpm build

# 실행
pnpm start

# 테스트
pnpm test
```

## 배포 반영

ssh dalpha-mac에 접속하여 다음 명령어 실행:

```bash
cd ~/projects/seongho/projects/claude-discord-bot
git pull origin main
pnpm install
pnpm build
pm2 restart claude-discord-bot
```

배포가 잘 되었는지 꼭 로그 확인:

```bash
pm2 logs claude-discord-bot
```
