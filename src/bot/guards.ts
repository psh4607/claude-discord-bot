import type { GuildChannel, GuildMember } from 'discord.js';

export function isClaudeCategory(
  channel: GuildChannel,
  categoryName: string,
): boolean {
  return channel.parent?.name === categoryName;
}

export function hasRequiredRole(
  member: GuildMember,
  roleName: string | undefined,
): boolean {
  if (!roleName) return true;
  return Array.from(member.roles.cache.values()).some(role => role.name === roleName);
}

export function canUseSession(
  channel: GuildChannel,
  member: GuildMember,
  categoryName: string,
  roleName: string | undefined,
): boolean {
  return isClaudeCategory(channel, categoryName) && hasRequiredRole(member, roleName);
}
