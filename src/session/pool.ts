import type { Client, TextChannel } from 'discord.js';

import type { Config } from '../config/index.js';
import type { MessageSender } from '../message/sender.js';
import { archiveSession, type ArchiveResult } from '../storage/archive.js';
import { SessionBridge } from './bridge.js';
import { SessionLogger } from './logger.js';
import { createQueryOptions } from './options.js';
import type { Workspace } from './workspace.js';

export class SessionPool {
  private bridges = new Map<string, SessionBridge>();

  constructor(
    private workspace: Workspace,
    private sender: MessageSender,
    private config: Config,
    private client: Client,
  ) {}

  async create(channelId: string, channel: TextChannel): Promise<SessionBridge> {
    const workspacePath = await this.workspace.create(channelId);
    const discordDir = this.workspace.getDiscordDir(channelId);
    const logger = new SessionLogger(discordDir);
    const options = createQueryOptions(this.config, this.client, channel, this.sender, logger);

    const bridge = new SessionBridge(
      channelId,
      channel,
      workspacePath,
      this.workspace,
      this.sender,
      logger,
      options,
    );

    this.bridges.set(channelId, bridge);
    return bridge;
  }

  async restore(channelId: string, channel: TextChannel): Promise<SessionBridge> {
    const workspacePath = this.workspace.getWorkspacePath(channelId);
    const sessionId = await this.workspace.loadSessionId(channelId);
    const discordDir = this.workspace.getDiscordDir(channelId);
    const logger = new SessionLogger(discordDir);
    const options = createQueryOptions(this.config, this.client, channel, this.sender, logger);

    const bridge = new SessionBridge(
      channelId,
      channel,
      workspacePath,
      this.workspace,
      this.sender,
      logger,
      options,
      sessionId ?? '',
    );

    this.bridges.set(channelId, bridge);
    return bridge;
  }

  get(channelId: string): SessionBridge | undefined {
    return this.bridges.get(channelId);
  }

  has(channelId: string): boolean {
    return this.bridges.has(channelId);
  }

  async close(channelId: string, channelName?: string): Promise<ArchiveResult | null> {
    const bridge = this.bridges.get(channelId);
    if (!bridge) return null;

    bridge.shutdown();
    this.sender.stopTyping(channelId);
    await this.sender.clearStatus(channelId);

    const result = await archiveSession(
      this.workspace,
      channelId,
      channelName ?? channelId,
    );

    this.bridges.delete(channelId);
    return result;
  }

  shutdown(): void {
    for (const bridge of this.bridges.values()) {
      bridge.shutdown();
    }
    this.bridges.clear();
  }

  get activeCount(): number {
    return this.bridges.size;
  }
}
