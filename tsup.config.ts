import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: [],
  external: ['@anthropic-ai/claude-agent-sdk', 'discord.js'],
});
