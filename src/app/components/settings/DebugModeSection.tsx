import styles from './Settings.module.css';

interface Props {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

// 控制 target.js 浮窗的默认显隐与详细日志
export default function DebugModeSection({ enabled, onToggle }: Props) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>调试模式</h2>
          <p className={styles.desc}>
            开启后，端侧 target.js 会显示一个浮窗，便于查看连接状态、强制重连
            与复制调试信息；同时会在端侧 console 打印关键事件日志。
            关闭则隐藏浮窗，但端侧仍可通过{' '}
            <code>localStorage.setItem('chii-debug', '1')</code>{' '}
            或 URL 参数 <code>?chii_debug=1</code> 强制启用。
          </p>
        </div>
        <label className={styles.switchInline}>
          <span className={styles.switchInlineLabel}>
            {enabled ? '已开启' : '已关闭'}
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
      </header>
    </section>
  );
}
