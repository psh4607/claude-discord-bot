import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Client, TextChannel } from 'discord.js';
import { z } from 'zod';

// 카테고리 제한 가드 — null이면 통과, string이면 에러 메시지
export function requireClaudeCategory(
  channel: { parent?: { name: string } | null } | null | undefined,
  categoryName: string,
): string | null {
  if (channel?.parent?.name !== categoryName) {
    return 'claude 카테고리 내 채널만 대상으로 할 수 있습니다';
  }
  return null;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function okResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function createDiscordMcpServer(
  client: Client,
  currentChannel: TextChannel,
  config: { categoryName: string },
) {
  const { categoryName } = config;

  return createSdkMcpServer({
    name: 'discord',
    tools: [
      // ─── 안전 도구 ───────────────────────────────────────────────

      tool(
        'list_channels',
        '서버 채널 목록을 조회합니다. filterCategory 옵션으로 카테고리별 필터링이 가능합니다.',
        {
          filterCategory: z.string().optional().describe('필터할 카테고리 이름'),
        },
        async ({ filterCategory }) => {
          const guild = currentChannel.guild;
          const channels = guild.channels.cache
            .filter(ch => {
              if (filterCategory) {
                return ch.parent?.name === filterCategory;
              }
              return true;
            })
            .map(ch => `${ch.name} (${ch.type}) [${ch.id}]`);
          return okResult(channels.join('\n') || '채널 없음');
        },
      ),

      tool(
        'set_channel_topic',
        '채널의 토픽을 변경합니다.',
        {
          channelId: z.string().describe('대상 채널 ID'),
          topic: z.string().describe('새 토픽 내용'),
        },
        async ({ channelId, topic }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            return errorResult('텍스트 채널을 찾을 수 없습니다');
          }
          if (!('setTopic' in channel)) {
            return errorResult('이 채널은 토픽 설정을 지원하지 않습니다');
          }
          await (channel as TextChannel).setTopic(topic);
          return okResult(`채널 토픽이 변경되었습니다: ${topic}`);
        },
      ),

      tool(
        'read_messages',
        '특정 채널의 최근 메시지를 읽습니다.',
        {
          channelId: z.string().describe('대상 채널 ID'),
          limit: z.number().min(1).max(100).default(10).describe('가져올 메시지 수 (기본 10)'),
        },
        async ({ channelId, limit }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            return errorResult('텍스트 채널을 찾을 수 없습니다');
          }
          const messages = await channel.messages.fetch({ limit });
          const lines = messages
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(m => `[${m.createdAt.toISOString()}] ${m.author.username}: ${m.content}`);
          return okResult(lines.join('\n') || '메시지 없음');
        },
      ),

      tool(
        'create_thread',
        '채널에 스레드를 생성합니다.',
        {
          channelId: z.string().describe('스레드를 생성할 채널 ID'),
          name: z.string().describe('스레드 이름'),
          messageId: z.string().optional().describe('스레드를 연결할 메시지 ID (선택)'),
        },
        async ({ channelId, name, messageId }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !('threads' in channel)) {
            return errorResult('스레드를 지원하는 채널을 찾을 수 없습니다');
          }
          const threadable = channel as TextChannel;
          if (messageId) {
            const message = await threadable.messages.fetch(messageId).catch(() => null);
            if (!message) return errorResult('메시지를 찾을 수 없습니다');
            const thread = await message.startThread({ name });
            return okResult(`스레드가 생성되었습니다: ${thread.name} [${thread.id}]`);
          }
          const thread = await threadable.threads.create({ name });
          return okResult(`스레드가 생성되었습니다: ${thread.name} [${thread.id}]`);
        },
      ),

      tool(
        'add_reaction',
        '메시지에 이모지 리액션을 추가합니다.',
        {
          channelId: z.string().describe('채널 ID'),
          messageId: z.string().describe('메시지 ID'),
          emoji: z.string().describe('추가할 이모지'),
        },
        async ({ channelId, messageId, emoji }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            return errorResult('텍스트 채널을 찾을 수 없습니다');
          }
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (!message) return errorResult('메시지를 찾을 수 없습니다');
          await message.react(emoji);
          return okResult(`리액션이 추가되었습니다: ${emoji}`);
        },
      ),

      tool(
        'pin_message',
        '메시지를 채널에 고정합니다.',
        {
          channelId: z.string().describe('채널 ID'),
          messageId: z.string().describe('고정할 메시지 ID'),
        },
        async ({ channelId, messageId }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            return errorResult('텍스트 채널을 찾을 수 없습니다');
          }
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (!message) return errorResult('메시지를 찾을 수 없습니다');
          await message.pin();
          return okResult('메시지가 고정되었습니다');
        },
      ),

      tool(
        'list_members',
        '서버 멤버 목록을 조회합니다.',
        {
          limit: z.number().min(1).max(1000).default(50).describe('가져올 멤버 수 (기본 50)'),
        },
        async ({ limit }) => {
          const guild = currentChannel.guild;
          const members = await guild.members.fetch({ limit });
          const lines = members.map(
            m => `${m.user.username}${m.nickname ? ` (${m.nickname})` : ''} [${m.id}]`,
          );
          return okResult(lines.join('\n') || '멤버 없음');
        },
      ),

      tool(
        'get_member_info',
        '특정 멤버의 정보를 조회합니다.',
        {
          memberId: z.string().describe('조회할 멤버 ID'),
        },
        async ({ memberId }) => {
          const guild = currentChannel.guild;
          const member = await guild.members.fetch(memberId).catch(() => null);
          if (!member) return errorResult('멤버를 찾을 수 없습니다');
          const roles = member.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => r.name)
            .join(', ');
          const info = [
            `이름: ${member.user.username}`,
            `닉네임: ${member.nickname ?? '없음'}`,
            `ID: ${member.id}`,
            `가입일: ${member.joinedAt?.toISOString() ?? '알 수 없음'}`,
            `역할: ${roles || '없음'}`,
          ].join('\n');
          return okResult(info);
        },
      ),

      // ─── 주의 도구 (claude 카테고리 제한) ────────────────────────

      tool(
        'send_message',
        'claude 카테고리 내 특정 채널에 메시지를 전송합니다.',
        {
          channelId: z.string().describe('대상 채널 ID'),
          content: z.string().describe('전송할 메시지 내용'),
        },
        async ({ channelId, content }) => {
          const channel = client.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            return errorResult('텍스트 채널을 찾을 수 없습니다');
          }
          const guard = requireClaudeCategory(channel as TextChannel, categoryName);
          if (guard) return errorResult(guard);
          await channel.send(content);
          return okResult('메시지가 전송되었습니다');
        },
      ),

      tool(
        'create_channel',
        'claude 카테고리에 새 채널을 생성합니다.',
        {
          name: z.string().describe('생성할 채널 이름'),
          topic: z.string().optional().describe('채널 토픽 (선택)'),
        },
        async ({ name, topic }) => {
          const guild = currentChannel.guild;
          const category = guild.channels.cache.find(
            ch => ch.name === categoryName && ch.type === 4, // ChannelType.GuildCategory
          );
          if (!category) return errorResult(`${categoryName} 카테고리를 찾을 수 없습니다`);
          const channel = await guild.channels.create({
            name,
            topic,
            parent: category.id,
          });
          return okResult(`채널이 생성되었습니다: ${channel.name} [${channel.id}]`);
        },
      ),

      // ─── 위험 도구 (카테고리 제한 + 추가 검증) ───────────────────

      tool(
        'delete_channel',
        'claude 카테고리 내 채널을 삭제합니다. 현재 채널은 삭제할 수 없습니다.',
        {
          channelId: z.string().describe('삭제할 채널 ID'),
        },
        async ({ channelId }) => {
          if (channelId === currentChannel.id) {
            return errorResult('현재 세션이 진행 중인 채널은 삭제할 수 없습니다');
          }
          const channel = client.channels.cache.get(channelId);
          if (!channel || !('parent' in channel)) {
            return errorResult('채널을 찾을 수 없습니다');
          }
          const guard = requireClaudeCategory(
            channel as { parent?: { name: string } | null },
            categoryName,
          );
          if (guard) return errorResult(guard);
          const channelName = 'name' in channel ? (channel as TextChannel).name : channelId;
          await channel.delete();
          return okResult(`채널이 삭제되었습니다: ${channelName}`);
        },
      ),

      tool(
        'assign_role',
        '멤버에게 역할을 부여합니다.',
        {
          memberId: z.string().describe('대상 멤버 ID'),
          roleId: z.string().describe('부여할 역할 ID'),
        },
        async (_args) => {
          return errorResult('이 기능은 현재 비활성화되어 있습니다');
        },
      ),

      tool(
        'remove_role',
        '멤버의 역할을 제거합니다.',
        {
          memberId: z.string().describe('대상 멤버 ID'),
          roleId: z.string().describe('제거할 역할 ID'),
        },
        async (_args) => {
          return errorResult('이 기능은 현재 비활성화되어 있습니다');
        },
      ),
    ],
  });
}
