// src/bot/events.ts
import type { Client, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';

import type { Config } from '../config/index.js';
import type { SessionPool } from '../session/pool.js';
import type { SkillCache } from '../skills/cache.js';
import { registerCommands, handleInteraction } from './commands.js';
import { isClaudeCategory, hasRequiredRole } from './guards.js';

export function registerEvents(
  client: Client,
  pool: SessionPool,
  config: Config,
  skillCache: SkillCache,
): void {
  client.on('channelCreate', async (channel) => {
    if (!isGuildTextChannel(channel)) return;
    if (!isClaudeCategory(channel, config.categoryName)) return;

    try {
      const bridge = await pool.create(channel.id, channel);
      bridge.enqueue('새 세션이 시작되었습니다. 간단히 인사해주세요.', 'system');
    } catch (err) {
      console.error(`세션 생성 실패 (${channel.id}):`, err);
      await channel.send('세션 연결에 실패했습니다.').catch(() => {});
    }
  });

  client.on('channelDelete', async (channel) => {
    if (!pool.has(channel.id)) return;

    try {
      await pool.close(channel.id, (channel as any).name);
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

    const bridge = pool.get(channel.id);
    if (!bridge) {
      await channel.send('세션이 연결되지 않았습니다. 채널을 다시 생성해주세요.');
      return;
    }

    bridge.enqueue(message.content, message.author.displayName);
  });

  client.once('ready', async () => {
    console.log(`봇 로그인 완료: ${client.user?.tag}`);

    // 슬래시 커맨드 등록 (guild별 1회)
    for (const guild of client.guilds.cache.values()) {
      await registerCommands(guild).catch(err =>
        console.error(`커맨드 등록 실패 (${guild.name}):`, err),
      );
    }

    await recoverSessions(client, pool, config);
  });

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

    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(interaction, pool, config);
    } catch (err) {
      console.error('슬래시 커맨드 처리 실패:', err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp('명령 처리 중 오류가 발생했습니다.').catch(() => {});
      } else {
        await interaction.reply('명령 처리 중 오류가 발생했습니다.').catch(() => {});
      }
    }
  });
}

async function recoverSessions(
  client: Client,
  pool: SessionPool,
  config: Config,
): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const channels = guild.channels.cache.filter(
      (ch) => isGuildTextChannel(ch) && isClaudeCategory(ch, config.categoryName),
    );

    for (const [, channel] of channels) {
      if (pool.has(channel.id)) continue;
      try {
        await pool.restore(channel.id, channel as TextChannel);
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
