/**
 * A question asked of Sara from another screen (the dashboard, a card on the map): it travels to
 * the Agent screen in this tab's storage and is sent there once, so there is one conversation.
 */
const KEY = 'moviq-pending-ask';

export function setPendingAsk(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // Without storage the Agent screen simply opens with an empty box.
  }
}

/** The waiting question, removed as it is read; null when there is none. */
export function takePendingAsk(): string | null {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message !== null) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}
