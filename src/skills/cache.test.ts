import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SkillEntry } from './scanner.js';

vi.mock('./scanner.js', () => ({
  scanSkillFiles: vi.fn(),
}));

import { scanSkillFiles } from './scanner.js';
import { SkillCache } from './cache.js';

const mockScanSkillFiles = vi.mocked(scanSkillFiles);

const sampleSkills: SkillEntry[] = [
  {
    name: 'deploy',
    namespace: 'devops',
    description: '서비스를 배포한다',
    fullName: 'devops/deploy',
    source: 'user',
  },
  {
    name: 'test',
    namespace: 'devops',
    description: '테스트를 실행한다',
    fullName: 'devops/test',
    source: 'project',
  },
  {
    name: 'format',
    namespace: 'code',
    description: '코드를 포맷한다',
    fullName: 'code/format',
    source: 'plugin',
  },
];

describe('SkillCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanSkillFiles.mockResolvedValue(sampleSkills);
  });

  it('initialize 후 getAll로 전체 스킬 반환', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    expect(cache.getAll()).toEqual(sampleSkills);
  });

  it('search로 fullName 필터링', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    const result = cache.search('devops/deploy');
    expect(result).toHaveLength(1);
    expect(result[0].fullName).toBe('devops/deploy');
  });

  it('search로 description 필터링', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    const result = cache.search('배포');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('deploy');
  });

  it('빈 query면 전체 반환', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    expect(cache.search('')).toEqual(sampleSkills);
  });

  it('getByNamespace로 특정 네임스페이스만 반환', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    const result = cache.getByNamespace('devops');
    expect(result).toHaveLength(2);
    expect(result.every(s => s.namespace === 'devops')).toBe(true);
  });

  it('count가 정확한 수 반환', async () => {
    const cache = new SkillCache(['cmd-dir'], ['plugin-dir']);
    await cache.initialize();
    expect(cache.count).toBe(3);
  });

  it('createDefault가 올바른 경로로 생성', () => {
    const home = homedir();
    const projectDir = '/project';
    const cache = SkillCache.createDefault(projectDir);
    expect(cache).toBeInstanceOf(SkillCache);

    // commandDirs와 pluginDirs를 간접 검증: initialize 호출 시 올바른 인자가 전달되는지 확인
    mockScanSkillFiles.mockResolvedValue([]);
    return cache.initialize().then(() => {
      const [commandDirs, pluginDirs] = mockScanSkillFiles.mock.calls[0];
      expect(commandDirs).toContain(join(home, '.claude', 'commands'));
      expect(commandDirs).toContain(join(projectDir, '.claude', 'commands'));
      expect(pluginDirs).toContain(join(home, '.claude', 'plugins'));
    });
  });
});
