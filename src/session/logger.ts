import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_RESPONSE_LENGTH = 500;

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function summarizeToolInput(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    return String(input);
  }

  const obj = input as Record<string, unknown>;

  const summarizers: Record<string, (o: Record<string, unknown>) => string> = {
    Read: (o) => String(o['file_path'] ?? ''),
    Write: (o) => String(o['file_path'] ?? ''),
    Edit: (o) => String(o['file_path'] ?? ''),
    Bash: (o) => String(o['description'] ?? o['command'] ?? ''),
    Grep: (o) => {
      const pattern = String(o['pattern'] ?? '');
      const path = String(o['path'] ?? '');
      return path ? `${pattern} in ${path}` : pattern;
    },
    Glob: (o) => String(o['pattern'] ?? ''),
  };

  const summarize = summarizers[name];
  return summarize ? summarize(obj) : JSON.stringify(input).slice(0, 100);
}

export class SessionLogger {
  private chatHistoryDir: string;

  constructor(discordDir: string) {
    this.chatHistoryDir = join(discordDir, 'chat-history');
  }

  currentLogPath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(this.chatHistoryDir, `${date}.md`);
  }

  async logUser(username: string, message: string): Promise<void> {
    const entry = `### [${timestamp()}] 👤 ${username}\n${message}\n\n`;
    await this.append(entry);
  }

  async logAssistant(response: string): Promise<void> {
    const text =
      response.length > MAX_RESPONSE_LENGTH
        ? `${response.slice(0, MAX_RESPONSE_LENGTH)}...(생략)`
        : response;
    const entry = `### [${timestamp()}] 🤖 Claude\n${text}\n\n`;
    await this.append(entry);
  }

  async logToolUse(toolName: string, input: unknown): Promise<void> {
    const summary = summarizeToolInput(toolName, input);
    const entry = `- 🔧 ${toolName}: ${summary}\n`;
    await this.append(entry);
  }

  async logToolResult(toolName: string, success: boolean, error?: string): Promise<void> {
    const icon = success ? '✅' : '❌';
    const detail = error ? ` ${error}` : '';
    const entry = `- ${icon} ${toolName}${detail}\n`;
    await this.append(entry);
  }

  async logError(error: string): Promise<void> {
    const entry = `### [${timestamp()}] ❌ 오류\n${error}\n\n`;
    await this.append(entry);
  }

  private async append(content: string): Promise<void> {
    await mkdir(this.chatHistoryDir, { recursive: true });
    await appendFile(this.currentLogPath(), content, 'utf-8');
  }
}
