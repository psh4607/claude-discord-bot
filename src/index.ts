// src/index.ts
import { loadConfig } from './config/index.js';
import { createClient } from './bot/client.js';
import { registerEvents } from './bot/events.js';
import { SessionPool } from './session/pool.js';
import { Workspace } from './session/workspace.js';
import { MessageSender } from './message/sender.js';
import { scheduleRetention } from './storage/retention.js';

async function main() {
  const config = loadConfig();
  const workspace = new Workspace(config.dataDir);
  const sender = new MessageSender();
  const client = createClient();
  const pool = new SessionPool(workspace, sender, config, client);

  registerEvents(client, pool, config);

  const retentionTimer = scheduleRetention(
    workspace.paths.archives,
    workspace.paths.longTerm,
    config.retentionDays,
  );

  const shutdown = async () => {
    console.log('종료 시작...');
    pool.shutdown();
    sender.cleanup();
    clearInterval(retentionTimer);
    client.destroy();
    console.log('종료 완료');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('시작 실패:', err);
  process.exit(1);
});
