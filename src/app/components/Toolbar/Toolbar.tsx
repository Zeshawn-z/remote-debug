import styles from './Toolbar.module.css';

export interface ToolbarRoom {
  /** 空串表示未加入 */
  current: string;
  alias?: string;
  /** 为真时不按房间过滤 */
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  onGoMine?: () => void;
}

interface Props {
  filter: string;
  onFilter: (value: string) => void;
  count: number;
  /** 计数项的单数标签，复数自动补 s */
  countLabel?: string;
  onHelp: () => void;
  /** 不传则不展示房间过滤区 */
  room?: ToolbarRoom;
}

export default function Toolbar({
  filter,
  onFilter,
  count,
  countLabel = 'Target',
  onHelp,
  room,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <input
        className={styles.filterInput}
        value={filter}
        placeholder="筛选"
        onChange={e => onFilter(e.target.value)}
      />
      <span className={styles.count}>
        {count} {countLabel}
        {count !== 1 ? 's' : ''}
      </span>
      {/* "查看我的"时展示当前房间信息；"查看全部"时不展示房间相关信息 */}
      {room && !room.showAll ? (
        <div className={styles.room}>
          <span className={styles.roomLabel}>房间</span>
          {room.current ? (
            <>
              <span className={styles.roomChip} title={room.current}>
                {room.alias || '(未命名)'}
              </span>
              {room.onGoMine ? (
                <button className={styles.roomLink} onClick={room.onGoMine}>
                  二维码
                </button>
              ) : null}
            </>
          ) : (
            <span className={styles.roomMuted}>未加入</span>
          )}
        </div>
      ) : null}
      <span className={styles.spacer} />
      {room ? (
        <div
          className={`${styles.viewToggle} ${
            room.showAll ? styles.viewAll : styles.viewMine
          }`}
          role="group"
          aria-label="查看范围"
        >
          <span className={styles.knob} aria-hidden="true" />
          <button
            type="button"
            className={`${styles.seg} ${room.showAll ? styles.segActive : ''}`}
            onClick={() => room.onShowAll(true)}
          >
            全部
          </button>
          <button
            type="button"
            className={`${styles.seg} ${!room.showAll ? styles.segActive : ''}`}
            onClick={() => room.onShowAll(false)}
          >
            我的
          </button>
        </div>
      ) : null}
      <button className={styles.helpBtn} onClick={onHelp}>
        帮助
      </button>
    </div>
  );
}
