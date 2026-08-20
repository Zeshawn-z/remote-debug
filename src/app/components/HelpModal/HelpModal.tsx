import { useEffect, useState } from 'react';
import { fetchSettings } from '../../api';
import styles from './HelpModal.module.css';

declare const window: any;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal({ open, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    fetchSettings().then(
      s => setBaseUrl(s.baseUrl || ''),
      () => {
        /* 忽略：留空回退到 window.domain */
      }
    );
  }, [open]);

  if (!open) {
    return null;
  }

  const domain = window.domain || '';
  const basePath = window.basePath || '';
  const version = window.version || '';
  // 未配置对外访问基地址时回退到服务端 domain
  const scriptBase = baseUrl
    ? `${baseUrl.trim().replace(/\/+$/, '')}${basePath}`
    : `${domain}${basePath}`;
  const scriptSnippet = `<script src="${scriptBase}target.js"></script>`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>帮助</span>
          <button className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.helpBlock}>
            <div className={styles.helpTitle}>手动注入</div>
            将以下脚本添加到目标页面：
            <pre className={styles.code}>{scriptSnippet}</pre>
          </div>
          <div className={styles.helpBlock}>
            <div className={styles.helpTitle}>尝试</div>
            打开{' '}
            <a href="test/demo.html" target="_blank" rel="noreferrer">
              DEMO
            </a>{' '}
            看看目标列表的效果。
          </div>
          <div className={styles.helpFooter}>
            <a href="https://github.com/liriliri/chii" target="_blank" rel="noreferrer">
              Chii v{version}
            </a>{' '}
            · Powered by Chrome DevTools
          </div>
        </div>
      </div>
    </div>
  );
}
