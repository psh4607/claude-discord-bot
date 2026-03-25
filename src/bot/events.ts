// src/bot/events.ts
import type { Client, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { SessionManager } from '../session/manager.js';
import type { Config } from '../config/index.js';
import { isClaudeCategory, hasRequiredRole } from './guards.js';

export function registerEvents(
  client: Client,
  sessionManager: SessionManager,
  config: Config,
): void {
  client.on('channelCreate', async (channel) => {
    if (!isGuildTextChannel(channel)) return;
    if (!isClaudeCategory(channel, config.categoryName)) return;

    // channelCreate 이벤트에서는 생성자 정보가 제공되지 않으므로
    // 세션만 생성하고, 역할 검증은 messageCreate에서 수행한다.
    try {
      await sessionManager.create(channel.id);
      await channel.send('Claude Code 세션이 연결되었습니다.');
    } catch (err) {
      console.error(`세션 생성 실패 (${channel.id}):`, err);
      await channel.send('세션 연결에 실패했습니다.').catch(() => {});
    }
  });

  client.on('channelDelete', async (channel) => {
    if (!sessionManager.has(channel.id)) return;

    try {
      await sessionManager.close(channel.id, (channel as any).name);
    } catch (err) {
      console.error(`세션 종료 실패 (${channel.id}):`, err);
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const channel = message.channel;
    if (!isGuildTextChannel(channel)) return;
    if (!isClaudeCategory(channel, config.categoryName)) return;

    const member = message.member;
    if (!member || !hasRequiredRole(member, config.requiredRole)) return;

    if (!sessionManager.has(channel.id)) {
      await channel.send('세션이 연결되지 않았습니다. 채널을 다시 생성해주세요.');
      return;
    }

    sessionManager.enqueue(channel.id, message.content, channel);
  });

  client.once('ready', async () => {
    console.log(`봇 로그인 완료: ${client.user?.tag}`);
    await recoverSessions(client, sessionManager, config);
  });
}

async function recoverSessions(
  client: Client,
  sessionManager: SessionManager,
  config: Config,
): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const channels = guild.channels.cache.filter(
      (ch) => isGuildTextChannel(ch) && isClaudeCategory(ch, config.categoryName),
    );

    for (const [, channel] of channels) {
      if (sessionManager.has(channel.id)) continue;
      try {
        await sessionManager.restore(channel.id);
        await (channel as TextChannel).send('세션이 재연결되었습니다.').catch(() => {});
      } catch (err) {
        console.error(`세션 복구 실패 (${channel.id}):`, err);
      }
    }
  }
}

function isGuildTextChannel(channel: any): channel is TextChannel {
  return channel.type === ChannelType.GuildText;
}
