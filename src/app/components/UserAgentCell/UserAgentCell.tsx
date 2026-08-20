import { useState } from 'react';
import { getOsIcon, getDeviceLabel } from '../../api';
import styles from './UserAgentCell.module.css';

interface Props {
  userAgent: string;
  // 受控展开，传入后与 URL 共享同一展开状态
  expanded?: boolean;
  onToggle?: () => void;
  // 是否显示自身详情按钮，展开由外部统一控制时可关闭
  showToggle?: boolean;
}

// UA 单元格
export default function UserAgentCell({
  userAgent,
  expanded,
  onToggle,
  showToggle = true,
}: Props) {
  const [localExpanded, setLocalExpanded] = useState(false);
  // 传入 expanded 即受控，否则回退到内部状态
  const isExpanded = expanded !== undefined ? expanded : localExpanded;
  const osIcon = getOsIcon(userAgent);
  const label = getDeviceLabel(userAgent);

  const toggle = () => {
    if (onToggle) onToggle();
    else setLocalExpanded(v => !v);
  };

  return (
    <span className={styles.wrap} title={userAgent}>
      {osIcon ? <img className={styles.osIcon} src={osIcon} /> : null}
      {isExpanded ? (
        <span className={styles.full}>{userAgent || '-'}</span>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      {userAgent && showToggle ? (
        <button
          className={styles.toggle}
          onClick={e => {
            e.stopPropagation();
            toggle();
          }}
        >
          {isExpanded ? '收起' : '详情'}
        </button>
      ) : null}
    </span>
  );
}
