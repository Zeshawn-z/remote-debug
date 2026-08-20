import { ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseUa } from '../../api';
import styles from './DeviceListPopup.module.css';

export interface DeviceBrief {
  id: string;
  userAgent: string;
}

interface Props {
  children: ReactNode;
  devices: DeviceBrief[];
  emptyText?: string;
}

export default function DeviceListPopup({ children, devices, emptyText }: Props) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const updatePos = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 6 });
  };

  const onEnter = () => {
    updatePos();
    setHover(true);
  };

  const popup =
    hover && typeof document !== 'undefined'
      ? createPortal(
          <div className={styles.popup} style={{ left: pos.left, top: pos.top }}>
            {devices.length === 0 ? (
              <div className={styles.empty}>{emptyText || '暂无设备'}</div>
            ) : (
              devices.map((d, i) => {
                const ua = parseUa(d.userAgent);
                return (
                  <div key={d.id + i} className={styles.item}>
                    <div className={styles.devId}>{d.id}</div>
                    <div className={styles.devMeta}>
                      {ua.system} · {ua.env}
                    </div>
                    <div className={styles.devUa}>{d.userAgent || '(无 UA)'}</div>
                  </div>
                );
              })
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <span
      ref={ref}
      className={styles.trigger}
      onMouseEnter={onEnter}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {popup}
    </span>
  );
}
