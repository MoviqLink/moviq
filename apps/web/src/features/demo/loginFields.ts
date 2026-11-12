import { PASSWORD_CHARACTER_MS, PASSWORD_DELAY_MS, USER_CHARACTER_MS } from './loginTimeline';

import type { Role } from './useDemoLogin';

/** The example credentials are visual only; authentication is handled by the demo API. */
export function loginFields(role: Role, elapsed: number) {
  const userId = role === 'traveller' ? 'usuario.demo' : 'proveedor.demo';
  const idLength = Math.min(userId.length, Math.max(0, Math.floor(elapsed / USER_CHARACTER_MS)));
  const passwordStart = userId.length * USER_CHARACTER_MS + PASSWORD_DELAY_MS;
  const passwordLength = Math.min(
    8,
    Math.max(0, Math.floor((elapsed - passwordStart) / PASSWORD_CHARACTER_MS)),
  );
  return { userId: userId.slice(0, idLength), password: 'demodemo'.slice(0, passwordLength) };
}
