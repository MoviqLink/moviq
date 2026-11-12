import { describe, expect, it } from 'vitest';

import { checkContent, checkEnvFiles, checkReadmes } from '../delivery-rules.js';

// Offending samples are assembled at run time so this file itself stays clean.
const MARKER = ['TO', 'DO'].join('');
const MAC_PATH = ['', 'Users', 'someone', 'project'].join('/');
const LINUX_HOME = ['', 'home', 'someone', 'project'].join('/');
const WINDOWS_PATH = ['C:', 'Users', 'someone'].join('/');
const OPENAI_KEY = `sk-${'a'.repeat(24)}`;

describe('checkReadmes', () => {
  it('asks for a README.md in the root and in every folder with files', () => {
    const problems = checkReadmes([
      'README.md',
      'apps/server/src/main.ts',
      'apps/server/README.md',
    ]);
    expect(problems.map((problem) => problem.path)).toEqual(['apps', 'apps/server/src']);
  });

  it('ignores hidden folders such as .github', () => {
    expect(checkReadmes(['README.md', '.github/workflows/verify.yml'])).toEqual([]);
  });
});

describe('checkEnvFiles', () => {
  it('refuses tracked environment files but allows the example', () => {
    const problems = checkEnvFiles(['.env', 'apps/server/.env.local', '.env.example', '.envrc']);
    expect(problems.map((problem) => problem.path)).toEqual([
      '.env',
      'apps/server/.env.local',
      '.envrc',
    ]);
  });
});

describe('checkContent', () => {
  it('finds machine paths, unfinished-work markers and secrets, with their line', () => {
    const text = [
      'const a = 1;',
      `// ${MARKER} later`,
      `const home = '${MAC_PATH}';`,
      `key: ${OPENAI_KEY}`,
    ].join('\n');
    const problems = checkContent('src/a.ts', text);
    expect(problems.map((problem) => [problem.rule, problem.line])).toEqual([
      ['work-marker', 2],
      ['local-path', 3],
      ['secret', 4],
    ]);
  });

  it('refuses credentials with a value in .env.example, and accepts empty ones', () => {
    const problems = checkContent(
      '.env.example',
      'PAYPAL_ENV=sandbox\nOPENAI_API_KEY=\nDUFFEL_TOKEN=abc\nexport ADMIN_TOKEN=value',
    );
    expect(problems.map((problem) => problem.line)).toEqual([3, 4]);
  });

  it('accepts settings that only mention a credential word, such as a token budget (regression)', () => {
    const problems = checkContent(
      '.env.example',
      'ASSISTANT_DAILY_TOKEN_BUDGET=200000\nKEYBOARD_LAYOUT=us\nPAYPAL_CLIENT_SECRET=shh',
    );
    expect(problems.map((problem) => problem.line)).toEqual([3]);
  });

  it('treats every fixtures folder as captures, not only the root one (regression)', () => {
    const long = `{ "name": "${'x'.repeat(130)}", "to": "XX ${'X'.repeat(3)}>US" }`;
    expect(checkContent('apps/web/tests/explore/fixtures/live.json', long)).toEqual([]);
    expect(checkContent('apps/recorder-cf/tools/fixtures-cpu/a.json', long)).toEqual([]);
    expect(checkContent('apps/web/src/fixtures.ts', long).map((p) => p.rule)).toEqual([
      'work-marker',
      'line-length',
    ]);
  });

  it('reads captures of providers as data: their own words are not work markers (regression)', () => {
    const capture = `{ "destination": "XX ${'X'.repeat(3)}>US" }`;
    expect(checkContent('tests/fixtures/sea/ships.json', capture)).toEqual([]);
    expect(checkContent('apps/server/src/a.ts', capture).map((p) => p.rule)).toEqual([
      'work-marker',
    ]);
  });

  it('finds Linux home folders and Windows paths with forward slashes (regression)', () => {
    const text = [
      `a = '${LINUX_HOME}'`,
      `b = '${WINDOWS_PATH}'`,
      'c = "https://example.com/home/page/"',
    ].join('\n');
    expect(checkContent('src/a.ts', text).map((problem) => [problem.rule, problem.line])).toEqual([
      ['local-path', 1],
      ['local-path', 2],
    ]);
  });

  it('limits code lines to 120 characters, but not prose, package.json or the lockfile', () => {
    const long = 'x'.repeat(121);
    expect(checkContent('src/a.ts', long).map((problem) => problem.rule)).toEqual(['line-length']);
    expect(checkContent('README.md', long)).toEqual([]);
    expect(checkContent('package-lock.json', long)).toEqual([]);
    expect(checkContent('apps/server/package.json', long)).toEqual([]);
    expect(checkContent('tests/fixtures/city/traffic.json', long)).toEqual([]);
  });
});
