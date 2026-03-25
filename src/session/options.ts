import type { Client, TextChannel } from 'discord.js';

import type { Config } from '../config/index.js';
import type { MessageSender } from '../message/sender.js';
import { createDiscordMcpServer } from '../tools/discord-mcp.js';
import type { SessionLogger } from './logger.js';
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
    mcpServers: {
      discord: createDiscordMcpServer(client, channel, { categoryName: config.categoryName }),
    },
    hooks: createHooks(channel, sender, logger),
  };
}
