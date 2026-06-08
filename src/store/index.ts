import { create } from 'zustand';
import { createConfigSlice, type ConfigSlice } from './slices/config';
import { createAuthSlice, type AuthSlice } from './slices/auth';
import { createSessionSlice, type SessionSlice } from './slices/session';
import { createUsageSlice, type UsageSlice } from './slices/usage';

export type AppStore = ConfigSlice & AuthSlice & SessionSlice & UsageSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createConfigSlice(...a),
  ...createAuthSlice(...a),
  ...createSessionSlice(...a),
  ...createUsageSlice(...a),
}));

// Typed selectors — prefer these over raw store access in components
export const selectActiveProvider = (s: AppStore) => s.appConfig.activeProvider;
export const selectActiveProviderConfig = (s: AppStore) =>
  s.providers[s.appConfig.activeProvider];
export const selectIsProviderReady = (provider: Parameters<AppStore['isProviderReady']>[0]) =>
  (s: AppStore) => s.isProviderReady(provider);
