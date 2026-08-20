import styles from './Nav.module.css';

export interface NavItem {
  key: string;
  label: string;
}

interface Props {
  items: NavItem[];
  active: string;
  onChange: (key: string) => void;
}

export default function Nav({ items, active, onChange }: Props) {
  return (
    <nav className={styles.nav}>
      {items.map(item => (
        <button
          key={item.key}
          className={`${styles.item} ${active === item.key ? styles.active : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
