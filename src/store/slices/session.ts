import type { StateCreator } from 'zustand';
import type { AgentSession, Message } from '../../types';

export interface SessionSlice {
  currentSession: AgentSession | null;
  messages: Message[];
  setSession(session: AgentSession | null): void;
  updateSession(patch: Partial<AgentSession>): void;
  appendMessage(msg: Message): void;
  updateMessage(id: string, patch: Partial<Message>): void;
  clearMessages(): void;
}

export const createSessionSlice: StateCreator<SessionSlice> = set => ({
  currentSession: null,
  messages: [],

  setSession(session) {
    set({ currentSession: session, messages: [] });
  },

  updateSession(patch) {
    set(state => ({
      currentSession: state.currentSession
        ? { ...state.currentSession, ...patch }
        : null,
    }));
  },

  appendMessage(msg) {
    set(state => ({ messages: [...state.messages, msg] }));
  },

  updateMessage(id, patch) {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === id ? ({ ...m, ...patch } as Message) : m
      ),
    }));
  },

  clearMessages() {
    set({ messages: [] });
  },
});
