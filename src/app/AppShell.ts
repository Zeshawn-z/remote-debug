import { createContext, useContext } from 'react';
import { Session } from './api';

export interface AppShell {
  openLogModal: (session: Session) => void;
  closeLogModal: () => void;
  openHelp: () => void;
  setActiveNav: (key: string) => void;
  logSession: Session | null;
}

export const AppShellContext = createContext<AppShell | null>(null);

export function useAppShell(): AppShell {
  const ctx = useContext(AppShellContext);
  if (!ctx) {
    throw new Error('useAppShell must be used inside AppShellContext.Provider');
  }
  return ctx;
}
