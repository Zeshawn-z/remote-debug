import { ReactNode } from 'react';
import Toolbar, { ToolbarRoom } from '../Toolbar/Toolbar';
import { useAppShell } from '../../AppShell';
import styles from './PageShell.module.css';

interface Props {
  /**
   * 不传则不展示 Toolbar。filter 与 count 由各页面自行控制，
   * 因为筛选语义与字段因页面而异。
   */
  toolbar?: {
    filter: string;
    onFilter: (v: string) => void;
    count: number;
    countLabel: string;
    room?: ToolbarRoom;
  };
  children: ReactNode;
}

export default function PageShell({ toolbar, children }: Props) {
  const shell = useAppShell();
  return (
    <div className={styles.page}>
      {toolbar ? (
        <Toolbar
          filter={toolbar.filter}
          onFilter={toolbar.onFilter}
          count={toolbar.count}
          countLabel={toolbar.countLabel}
          onHelp={shell.openHelp}
          room={toolbar.room}
        />
      ) : null}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
