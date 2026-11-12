import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';

describe('the recording configuration', () => {
  it('is off without RECORDING_DIR, and keeps 7 days of raw recording by default', () => {
    const result = loadConfig({});
    expect(result.ok && result.config.recording).toEqual({
      directory: undefined,
      retentionDays: 7,
    });
  });

  it('takes an absolute folder and a retention in days', () => {
    const result = loadConfig({
      RECORDING_DIR: '/var/lib/recording',
      RECORDING_RETENTION_DAYS: '14',
    });
    expect(result.ok && result.config.recording).toEqual({
      directory: '/var/lib/recording',
      retentionDays: 14,
    });
  });

  it('refuses a relative folder and a retention out of range, naming the rule', () => {
    expect(loadConfig({ RECORDING_DIR: 'data/recording', RECORDING_RETENTION_DAYS: '0' })).toEqual({
      ok: false,
      problems: [
        'RECORDING_DIR must be an absolute path',
        'RECORDING_RETENTION_DAYS must be a whole number of days from 1 to 90',
      ],
    });
  });
});
