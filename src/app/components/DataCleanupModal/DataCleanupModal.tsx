import { useEffect, useState } from 'react';
import { clearData, DataType } from '../../api';
import styles from './DataCleanupModal.module.css';

export interface DataTypeMeta {
  key: DataType;
  label: string;
  /** 清理影响说明 */
  desc: string;
}

interface Props {
  /** 为 null 时不渲染 */
  target: DataTypeMeta | null;
  onClose: () => void;
  onDone?: (type: DataType) => void;
}

export default function DataCleanupModal({ target, onClose, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 切换目标时重置内部状态
  useEffect(() => {
    setStep(1);
    setInput('');
    setBusy(false);
    setErr('');
  }, [target]);

  if (!target) return null;

  const keyword = target.key;
  const matched = input.trim() === keyword;

  const close = () => {
    if (busy) return;
    onClose();
  };

  const doClear = () => {
    if (!matched || busy) return;
    setBusy(true);
    setErr('');
    clearData(target.key).then(
      () => {
        setBusy(false);
        if (onDone) onDone(target.key);
        onClose();
      },
      e => {
        setBusy(false);
        setErr((e && e.message) || '清理失败');
      }
    );
  };

  return (
    <div className={styles.overlay} onClick={close}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>清理「{target.label}」</span>
          <button className={styles.closeBtn} onClick={close}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          {step === 1 ? (
            <>
              <div className={styles.warnBox}>
                你正在清理 <span className={styles.target}>{target.label}</span>
                。此操作 <strong>不可恢复</strong>。
              </div>
              <div>{target.desc}</div>
            </>
          ) : (
            <>
              <div className={styles.step}>第 2 步 / 共 2 步 · 二次确认</div>
              <div className={styles.confirmTip}>
                请输入 <span className={styles.kw}>{keyword}</span>{' '}
                以确认执行清理：
              </div>
              <input
                className={styles.input}
                value={input}
                autoFocus
                placeholder={keyword}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') doClear();
                }}
              />
              {err ? <div className={styles.err}>{err}</div> : null}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.btn} onClick={close} disabled={busy}>
            取消
          </button>
          {step === 1 ? (
            <button className={styles.btnDanger} onClick={() => setStep(2)}>
              我已了解，继续
            </button>
          ) : (
            <button
              className={styles.btnDanger}
              onClick={doClear}
              disabled={!matched || busy}
            >
              {busy ? '清理中…' : '确认清理'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
