import { AttachmentBuilder, type Message, type TextChannel } from 'discord.js';

import type { FormattedMessage } from './formatter.js';

interface StatusLogEntry {
  message: Message;
  lines: string[];
  startTime: number;
}

export class MessageSender {
  private typingIntervals = new Map<string, NodeJS.Timeout>();
  private statusMessages = new Map<string, Message>();
  private statusLogs = new Map<string, StatusLogEntry>();

  startTyping(channel: TextChannel): void {
    channel.sendTyping();
    const interval = setInterval(() => channel.sendTyping(), 9000);
    this.typingIntervals.set(channel.id, interval);
  }

  stopTyping(channelId: string): void {
    const interval = this.typingIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(channelId);
    }
  }

  async sendStatusUpdate(channel: TextChannel, status: string): Promise<void> {
    const existing = this.statusMessages.get(channel.id);
    if (existing) {
      await existing.edit(status).catch(() => {});
    } else {
      const msg = await channel.send(status);
      this.statusMessages.set(channel.id, msg);
    }
  }

  async clearStatus(channelId: string): Promise<void> {
    const msg = this.statusMessages.get(channelId);
    if (msg) {
      await msg.delete().catch(() => {});
      this.statusMessages.delete(channelId);
    }
  }

  async sendResponse(channel: TextChannel, formatted: FormattedMessage): Promise<void> {
    if (formatted.type === 'text') {
      for (const chunk of formatted.chunks) {
        await channel.send(chunk);
      }
    } else {
      const attachment = new AttachmentBuilder(
        Buffer.from(formatted.content, 'utf-8'),
        { name: formatted.filename },
      );
      await channel.send({
        content: formatted.summary,
        files: [attachment],
      });
    }
  }

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

  cleanup(): void {
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    for (const msg of this.statusMessages.values()) {
      msg.delete().catch(() => {});
    }
    this.statusMessages.clear();

    this.statusLogs.clear();
  }
}
