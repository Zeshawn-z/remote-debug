import { useCallback, useEffect, useMemo, useState } from 'react';
import { Session } from './api';
import Header from './components/Header/Header';
import HelpModal from './components/HelpModal/HelpModal';
import LogModal from './components/LogModal/LogModal';
import { AppShellContext, AppShell } from './AppShell';
import { NAV_DEFS, DEFAULT_NAV, navFromHash } from './navConfig';
import './global.css';
import styles from './App.module.css';

export default function App() {
  const [activeNav, setActiveNavState] = useState(
    () => navFromHash() || DEFAULT_NAV
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [logSession, setLogSession] = useState<Session | null>(null);

  const setActiveNav = useCallback((key: string) => {
    setActiveNavState(key);
    if (navFromHash() !== key) {
      location.hash = `/${key}`;
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      const key = navFromHash();
      if (key) setActiveNavState(key);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const shell: AppShell = useMemo(
    () => ({
      openLogModal: setLogSession,
      closeLogModal: () => setLogSession(null),
      openHelp: () => setHelpOpen(true),
      setActiveNav,
      logSession,
    }),
    [setActiveNav, logSession]
  );

  const navItems = useMemo(
    () =>
      NAV_DEFS.map(n => ({
        key: n.key,
        label: n.label,
      })),
    []
  );

  const navDef = NAV_DEFS.find(n => n.key === activeNav);
  const PageComp = (navDef && navDef.page) || NAV_DEFS[0].page;

  return (
    <AppShellContext.Provider value={shell}>
      <Header
        navItems={navItems}
        activeNav={activeNav}
        onNavChange={setActiveNav}
      />
      <div className={styles.container}>
        <div className={styles.panel}>
          <PageComp />
        </div>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <LogModal session={logSession} onClose={() => setLogSession(null)} />
    </AppShellContext.Provider>
  );
}
