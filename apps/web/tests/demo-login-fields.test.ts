import { describe, expect, it } from 'vitest';

import { loginFields } from '../src/features/demo/loginFields';
import {
  LOGIN_DURATION_MS,
  PASSWORD_DELAY_MS,
  USER_CHARACTER_MS,
} from '../src/features/demo/loginTimeline';

describe('demonstration credentials', () => {
  it('types the role ID before the example password and completes within three seconds', () => {
    for (const [role, expected] of [
      ['traveller', 'usuario.demo'],
      ['partner', 'proveedor.demo'],
    ] as const) {
      expect(loginFields(role, 0)).toEqual({ userId: '', password: '' });
      expect(
        loginFields(role, expected.length * USER_CHARACTER_MS + PASSWORD_DELAY_MS - 1).password,
      ).toBe('');
      expect(loginFields(role, expected.length * USER_CHARACTER_MS + PASSWORD_DELAY_MS)).toEqual({
        userId: expected,
        password: '',
      });
      expect(loginFields(role, LOGIN_DURATION_MS)).toEqual({
        userId: expected,
        password: 'demodemo',
      });
    }
  });
});
