import { useMemo, useState } from 'react';
import { TitleRule } from '../../api';
import { ruleMatchesUrl } from '../../utils/settingsUtils';
import styles from './Settings.module.css';

interface Props {
  rules: TitleRule[];
  loaded: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<TitleRule>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

export default function TitleRulesSection({
  rules,
  loaded,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}: Props) {
  const [testUrl, setTestUrl] = useState('');

  // 预览 testUrl 命中哪条规则
  const matchedRule = useMemo(() => {
    if (!testUrl) return null;
    for (const r of rules) {
      if (ruleMatchesUrl(r, testUrl)) return r;
    }
    return null;
  }, [rules, testUrl]);

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>标题覆盖</h2>
          <p className={styles.desc}>
            按匹配规则覆写标题. 使用 <code>*</code> 匹配任意字符，{' '}
            <code>?</code> 匹配单字符. 勾选<strong>业务域名</strong>后无需填域名，直接填路径子串即可
            开启按路径匹配后，只在设置里配置的业务域名下生效。规则优先级从上到下
          </p>
        </div>
        <button className={styles.addBtn} onClick={onAdd}>
          + 添加
        </button>
      </header>

      {!loaded && rules.length === 0 ? (
        <div className={styles.empty}>加载中…</div>
      ) : null}

      {loaded && rules.length === 0 ? (
        <div className={styles.empty}>暂无规则，请添加规则</div>
      ) : null}

      {rules.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={`${styles.th} ${styles.thEnabled}`}>启用</th>
              <th className={`${styles.th} ${styles.thEnabled}`}>业务域名</th>
              <th className={styles.th}>{'匹配规则 / 路径子串'}</th>
              <th className={styles.th}>覆写标题</th>
              <th className={`${styles.th} ${styles.thAction}`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id} className={styles.row}>
                <td className={`${styles.td} ${styles.tdEnabled}`}>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={e => onUpdate(r.id, { enabled: e.target.checked })}
                    />
                    <span className={styles.slider} />
                  </label>
                </td>
                <td className={`${styles.td} ${styles.tdEnabled}`}>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={!!r.bizDomain}
                      onChange={e => onUpdate(r.id, { bizDomain: e.target.checked })}
                    />
                    <span className={styles.slider} />
                  </label>
                </td>
                <td className={styles.td}>
                  <input
                    className={styles.input}
                    value={r.pattern}
                    placeholder={r.bizDomain ? '路径子串，如 /premeeting' : '*://example.com/*'}
                    onChange={e => onUpdate(r.id, { pattern: e.target.value })}
                  />
                </td>
                <td className={styles.td}>
                  <input
                    className={styles.input}
                    value={r.title}
                    placeholder="Display name"
                    onChange={e => onUpdate(r.id, { title: e.target.value })}
                  />
                </td>
                <td className={`${styles.td} ${styles.tdAction}`}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => onMove(r.id, -1)}
                    disabled={i === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => onMove(r.id, 1)}
                    disabled={i === rules.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => onRemove(r.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className={styles.testBox}>
        <label className={styles.testLabel}>测试 URL</label>
        <input
          className={styles.input}
          value={testUrl}
          placeholder="https://example.com/path"
          onChange={e => setTestUrl(e.target.value)}
        />
        {testUrl ? (
          matchedRule ? (
            <span className={styles.testHit}>
              → <strong>{matchedRule.title}</strong>{' '}
              <span className={styles.testPattern}>
                ({matchedRule.bizDomain ? '业务域名: ' : ''}
                {matchedRule.pattern})
              </span>
            </span>
          ) : (
            <span className={styles.testMiss}>→ 无匹配项 (使用原始标题)</span>
          )
        ) : null}
      </div>
    </section>
  );
}
