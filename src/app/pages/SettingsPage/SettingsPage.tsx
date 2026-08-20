import PageShell from '../../components/PageShell/PageShell';
import useSettings from '../../hooks/useSettings';
import DebugModeSection from '../../components/settings/DebugModeSection';
import ConnLogSection from '../../components/settings/ConnLogSection';
import DataCleanupSection from '../../components/settings/DataCleanupSection';
import BaseUrlSection from '../../components/settings/BaseUrlSection';
import BizHostsSection from '../../components/settings/BizHostsSection';
import TitleRulesSection from '../../components/settings/TitleRulesSection';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const {
    rules,
    debugEnabled,
    connLogEnabled,
    baseUrl,
    bizHosts,
    loaded,
    saving,
    dirty,
    errorMsg,
    successMsg,
    addRule,
    updateRule,
    removeRule,
    moveRule,
    toggleDebug,
    toggleConnLog,
    setBaseUrl,
    setBizHosts,
    save,
  } = useSettings();

  return (
    <PageShell>
      <div className={styles.wrap}>
        <div className={styles.scroll}>
          <TitleRulesSection
            rules={rules}
            loaded={loaded}
            onAdd={addRule}
            onUpdate={updateRule}
            onRemove={removeRule}
            onMove={moveRule}
          />

          <DebugModeSection enabled={debugEnabled} onToggle={toggleDebug} />

          <ConnLogSection enabled={connLogEnabled} onToggle={toggleConnLog} />

          <BaseUrlSection value={baseUrl} onChange={setBaseUrl} />

          <BizHostsSection value={bizHosts} onChange={setBizHosts} />

          <DataCleanupSection />
        </div>

        <footer className={styles.footer}>
          {errorMsg ? <span className={styles.error}>{errorMsg}</span> : null}
          {successMsg ? (
            <span className={styles.success}>{successMsg}</span>
          ) : null}
          <span className={styles.spacer} />
          <button
            className={styles.saveBtn}
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? '保存中…' : dirty ? '保存' : '已保存'}
          </button>
        </footer>
      </div>
    </PageShell>
  );
}
