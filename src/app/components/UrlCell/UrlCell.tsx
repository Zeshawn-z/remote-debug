import { useRef, useState, ClipboardEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { shortBizUrl } from '../../utils/envUtils';
import { copyToClipboard } from '../../utils/clipboard';
import { showToast } from '../../utils/toast';
import styles from './UrlCell.module.css';

interface Props {
  url: string;
  // 与 UA 共享行展开态，展开时换行显示全长
  expanded?: boolean;
  onToggle?: () => void;
  // 是否显示自身详情按钮，展开由外部统一控制时可关闭
  showToggle?: boolean;
}

const GAP = 8;
const POPUP_MAXW = 480;

// URL 单元格
export default function UrlCell({ url, expanded, onToggle, showToggle = true }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const display = shortBizUrl(url);

  const show = () => {
    if (!url || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = r.left;
    if (left + POPUP_MAXW > window.innerWidth) {
      left = Math.max(GAP, window.innerWidth - POPUP_MAXW - GAP);
    }
    // 底部空间不足时翻到上方，避免被视口裁剪
    const above = r.bottom + 80 > window.innerHeight;
    const top = above ? r.top - GAP : r.bottom + GAP;
    setPos({ left, top, above });
  };

  const hide = () => setPos(null);

  // 选中复制时强制写入完整 URL，保证复制到的始终是全长链接
  const onCopy = (e: ClipboardEvent<HTMLAnchorElement>) => {
    e.clipboardData.setData('text/plain', url);
    e.preventDefault();
  };

  // 右键直接复制全长链接并提示，不弹出系统菜单
  const onContextMenu = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!url) return;
    e.preventDefault();
    copyToClipboard(url).then(
      () => showToast('复制成功'),
      () => showToast('复制失败')
    );
  };

  return (
    <span className={styles.wrap}>
      <a
        ref={ref}
        className={`${styles.url} ${expanded ? styles.expanded : styles.ellipsis}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        onCopy={onCopy}
        onContextMenu={onContextMenu}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {display}
      </a>
      {url && showToggle ? (
        <button
          className={styles.toggle}
          onClick={e => {
            e.stopPropagation();
            onToggle && onToggle();
          }}
        >
          {expanded ? '收起' : '详情'}
        </button>
      ) : null}
      {pos && url
        ? createPortal(
            <div
              className={styles.popup}
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.above ? 'translateY(-100%)' : undefined,
              }}
            >
              {url}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
