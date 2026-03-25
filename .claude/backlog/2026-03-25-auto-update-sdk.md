# Claude Code SDK 자동 업데이트 및 봇 재시작 자동화

- 생성일: 2026-03-25
- 우선순위: P3 (낮음)
- 상태: 대기

## 맥락

v2 SDK 리팩토링 브레인스토밍 중, Discord 슬래시 커맨드를 Claude Code 하네스에서 동적으로 조회하여 자동 등록하는 설계를 논의했다. `session.initializationResult()`로 지원 명령어/모델/에이전트를 가져와 Discord에 자동 반영하는 구조인데, SDK가 업데이트되면 봇 재시작만으로 새 기능이 반영된다. 이 과정을 수동이 아닌 자동으로 하면 좋겠다는 논의가 있었다.

현재 dalpha-mac에서 pm2로 봇을 운영 중이며, `@anthropic-ai/claude-agent-sdk`와 `@anthropic-ai/claude-code` (글로벌) 두 패키지가 관리 대상이다.

## 내용

pm2 + cron을 활용하여 Claude Code SDK 업데이트를 주기적으로 체크하고, 새 버전이 있으면 자동으로 업데이트 후 봇을 재시작하는 자동화 파이프라인을 구축한다.

- SDK 패키지 (`@anthropic-ai/claude-agent-sdk`) 새 버전 감지
- 글로벌 Claude Code CLI (`@anthropic-ai/claude-code`) 새 버전 감지
- 업데이트 발견 시 자동 설치 + pm2 재시작
- 업데이트 로그 기록

## 디자인 방향

- cron 스크립트 (`scripts/check-update.sh`)를 만들어 1일 1회 실행
- `npm outdated --json` 또는 `pnpm outdated --json`으로 새 버전 감지
- 새 버전이 있으면 `pnpm update` → `pnpm build` → `pm2 restart claude-discord-bot`
- 글로벌 CLI는 `npm outdated -g --json`으로 체크 → `npm update -g @anthropic-ai/claude-code`
- 결과를 `.discord/chat-history/` 또는 별도 로그 파일에 기록
- 실패 시 Discord 채널에 알림 전송 (봇의 custom tool 활용 가능)

## 관련 파일

- `package.json` - SDK 의존성 정의
- `tsup.config.ts` - 빌드 설정 (external로 SDK 지정됨)
