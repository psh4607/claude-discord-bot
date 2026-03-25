import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { TextChannel } from 'discord.js';

import { formatResponse } from '../message/formatter.js';
import type { MessageSender } from '../message/sender.js';
import type { SessionLogger } from './logger.js';
import type { Workspace } from './workspace.js';

interface QueueItem {
  prompt: string;
  username: string;
}

export class SessionBridge {
  private sessionId: string;
  private activeQuery: Query | null = null;
  private queue: QueueItem[] = [];
  private processing = false;
  private shuttingDown = false;

  constructor(
    private channelId: string,
    private channel: TextChannel,
    private workspacePath: string,
    private workspace: Workspace,
    private sender: MessageSender,
    private logger: SessionLogger,
    private options: Record<string, unknown>,
    initialSessionId: string = '',
  ) {
    this.sessionId = initialSessionId;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  enqueue(prompt: string, username: string): void {
    if (this.shuttingDown) return;
    this.queue.push({ prompt, username });
    if (!this.processing) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.processMessage(item);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '알 수 없는 오류';
        this.logger.logError(errorMsg);
        await this.channel.send(`오류가 발생했습니다: ${errorMsg}`).catch(() => {});
      }
    }
    this.processing = false;
  }

  private async processMessage(item: QueueItem): Promise<void> {
    await this.logger.logUser(item.username, item.prompt);
    this.sender.startTyping(this.channel);

    try {
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
          await this.workspace.saveSessionId(this.channelId, this.sessionId);
          await this.logger.logAssistant(msg.result);
          await this.sender.finalizeStatusLog(this.channelId);
          await this.sender.sendResponse(this.channel, formatResponse(msg.result));
        } else if (msg.type === 'result') {
          await this.logger.logError(msg.subtype);
          await this.channel.send(`오류가 발생했습니다: ${msg.subtype}`).catch(() => {});
        }
      }

      this.activeQuery = null;
    } catch (err) {
      this.activeQuery = null;

      // resume 실패 시 새 세션으로 폴백
      if (this.sessionId && String(err).includes('session')) {
        this.sessionId = '';
        await this.workspace.saveSessionId(this.channelId, '').catch(() => {});
        await this.channel.send('세션이 만료되었습니다. 새 세션으로 시작합니다.').catch(() => {});
        return;
      }

      throw err;
    } finally {
      this.sender.stopTyping(this.channelId);
    }
  }

  abort(): void {
    if (this.activeQuery) {
      this.activeQuery.close();
      this.activeQuery = null;
    }
  }

  resetSession(): void {
    this.abort();
    this.sessionId = '';
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.abort();
    this.queue = [];
    this.sender.stopTyping(this.channelId);
    this.sender.finalizeStatusLog(this.channelId).catch(() => {});
  }
}
