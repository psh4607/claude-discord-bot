import { resolve } from 'node:path';

export interface Config {
  discordToken: string;
  categoryName: string;
  requiredRole: string | undefined;
  dataDir: string;
  retentionDays: number;
  model: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`환경변수 ${key}가 설정되지 않았습니다`);
  return value;
}

export function loadConfig(): Config {
  return {
    discordToken: requireEnv('DISCORD_TOKEN'),
    requiredRole: process.env.DISCORD_REQUIRED_ROLE,
    categoryName: process.env.DISCORD_CATEGORY_NAME ?? 'claude',
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    retentionDays: Number(process.env.ARCHIVE_RETENTION_DAYS ?? '30'),
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  };
}
