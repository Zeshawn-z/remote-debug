import { useRef, useState, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ScreenshotHover.module.css';

interface Props {
  /** 为空时不显示 popup，只渲染 children */
  url?: string | null;
  children: ReactNode;
  className?: string;
}

// 预估的 popup 宽度，含 padding，据此判断是否翻转到左侧
const POPUP_WIDTH = 372;
const GAP = 12;

// 同一张快照 5 秒内只上报一次
// 用 portal 渲染到 body，避免被表格滚动容器裁剪
export default function ScreenshotHover({ url, children, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading'
  );

  const show = () => {
    if (!url || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    // 右侧空间不足则放左侧
    let left = r.right + GAP;
    if (left + POPUP_WIDTH > window.innerWidth) {
      left = Math.max(GAP, r.left - GAP - POPUP_WIDTH);
    }
    // 与标题对齐，同时避免超出视口底部
    let top = r.top;
    const estHeight = 260;
    if (top + estHeight > window.innerHeight) {
      top = Math.max(GAP, window.innerHeight - estHeight - GAP);
    }
    setStatus('loading');
    setPos({ left, top });
  };

  const hide = () => setPos(null);

  const onLoaded = useCallback(() => {
    setStatus('loaded');
  }, []);

  // 缓存图片在新挂载的 img 上可能不触发 onLoad，挂载时主动检查 complete
  const handleImgRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) return;
      if (node.complete) {
        if (node.naturalWidth > 0) {
          onLoaded();
        } else {
          setStatus('error');
        }
      }
    },
    [onLoaded]
  );

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {pos && url
        ? createPortal(
            <div
              className={styles.popup}
              style={{ left: pos.left, top: pos.top }}
            >
              {status === 'error' ? (
                <div className={styles.error}>快照加载失败</div>
              ) : (
                <>
                  {status === 'loading' ? (
                    <div className={styles.loading}>快照加载中…</div>
                  ) : null}
                  <img
                    ref={handleImgRef}
                    className={styles.img}
                    src={url}
                    style={
                      status === 'loaded' ? undefined : { display: 'none' }
                    }
                    onLoad={onLoaded}
                    onError={() => setStatus('error')}
                  />
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
