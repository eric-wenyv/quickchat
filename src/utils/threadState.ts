import type { UUID } from '@/types/types';

export type ThreadSendingState = Record<UUID, boolean>;

export function markThreadSending(state: ThreadSendingState, conversationId: UUID): ThreadSendingState {
  return { ...state, [conversationId]: true };
}

export function markThreadIdle(state: ThreadSendingState, conversationId: UUID): ThreadSendingState {
  if (!state[conversationId]) return state;
  const next = { ...state };
  delete next[conversationId];
  return next;
}

export function isThreadSending(state: ThreadSendingState, conversationId: UUID | null | undefined): boolean {
  return Boolean(conversationId && state[conversationId]);
}
