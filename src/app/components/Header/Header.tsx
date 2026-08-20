import Nav, { NavItem } from '../Nav/Nav';
import styles from './Header.module.css';

declare const window: any;

interface Props {
  navItems: NavItem[];
  activeNav: string;
  onNavChange: (key: string) => void;
}

export default function Header({ navItems, activeNav, onNavChange }: Props) {
  const version = window.version || '';

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>
          {/* 与页面内调试浮窗同款图标 */}
          <svg
            className={styles.logo}
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--primary)" />
            <path
              d="M9.5 8L6 12l3.5 4"
              stroke="#fff"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M14.5 8L18 12l-3.5 4"
              stroke="#fff"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span className={styles.brandName}>Chii Remote Debug</span>
          {version ? <span className={styles.badge}>v{version}</span> : null}
        </div>
        <span className={styles.spacer} />
        <Nav items={navItems} active={activeNav} onChange={onNavChange} />
      </div>
    </header>
  );
}
