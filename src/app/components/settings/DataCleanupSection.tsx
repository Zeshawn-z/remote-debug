import { useState } from 'react';
import DataCleanupModal, {
  DataTypeMeta,
} from '../DataCleanupModal/DataCleanupModal';
import styles from './Settings.module.css';
import local from './DataCleanupSection.module.css';

const DATA_TYPES: DataTypeMeta[] = [
  {
    key: 'logs',
    label: '连接日志',
    desc: '删除全部连接日志（logs）：内存展示记录及磁盘归档文件 logs/conn-*.log。',
  },
  {
    key: 'sessions',
    label: '会话与日志',
    desc: '删除全部会话（sessions）：会话列表、日志明细与页面快照，并断开当前活跃的调试连接。',
  },
  {
    key: 'rooms',
    label: '房间',
    desc: '删除全部房间（rooms）及其别名，并通知在线设备解除房间归属。',
  },
];

// 每次清理都要过弹窗的多重确认，防止误删
export default function DataCleanupSection() {
  const [target, setTarget] = useState<DataTypeMeta | null>(null);
  const [doneMsg, setDoneMsg] = useState('');

  const onDone = (meta: DataTypeMeta) => {
    setDoneMsg(`已清理「${meta.label}」`);
    window.setTimeout(() => setDoneMsg(''), 3000);
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>清理数据</h2>
          <p className={styles.desc}>
            分类型清空服务端存储的数据。所有清理均不可恢复，执行前需经过多重确认。
            {doneMsg ? (
              <span style={{ color: '#30a46c', marginLeft: 8 }}>{doneMsg}</span>
            ) : null}
          </p>
        </div>
      </header>

      <div className={local.list}>
        {DATA_TYPES.map(meta => (
          <div className={local.item} key={meta.key}>
            <div className={local.itemInfo}>
              <div className={local.itemLabel}>{meta.label}</div>
              <div className={local.itemDesc}>{meta.desc}</div>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={() => setTarget(meta)}
            >
              清理
            </button>
          </div>
        ))}
      </div>

      <DataCleanupModal
        target={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          if (target) onDone(target);
        }}
      />
    </section>
  );
}
