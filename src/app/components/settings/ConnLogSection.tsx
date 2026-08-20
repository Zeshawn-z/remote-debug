import { useState } from 'react';
import ConnLogModal from '../ConnLogModal/ConnLogModal';
import styles from './Settings.module.css';

interface Props {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

// 日志明细放弹窗，不占设置页篇幅
export default function ConnLogSection({ enabled, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>连接日志</h2>
          <p className={styles.desc}>
            记录每一次到达本服务的 WebSocket 握手请求及其结果
          </p>
        </div>
        <div className={styles.connLogTools}>
          <label
            className={styles.switchInline}
            title="停用后不再记录新的连接（历史仍可查看）；改动需点击底部“保存”生效"
          >
            <span className={styles.switchInlineLabel}>
              {enabled ? '记录中' : '已停用'}
            </span>
            <span className={styles.switch}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => onToggle(e.target.checked)}
              />
              <span className={styles.slider} />
            </span>
          </label>
          <button className={styles.addBtn} onClick={() => setOpen(true)}>
            查看日志
          </button>
        </div>
      </header>

      <ConnLogModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
