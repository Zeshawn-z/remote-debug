import styles from './Settings.module.css';

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
}

// 业务域名配置，影响 URL 精简显示与标题规则的 bizDomain 开关
export default function BizHostsSection({ value, onChange }: Props) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>业务域名</h2>
          <p className={styles.desc}>
            一行一条 host 匹配规则，支持 * 与 ?，例如 *.example.com。
            命中后列表里的 URL 只显示路径，标题规则也可以开启「按路径匹配」。
            留空时 URL 完整显示。
          </p>
        </div>
      </header>
      <textarea
        className={styles.input}
        style={{ maxWidth: 480, height: 88, resize: 'vertical' }}
        value={value.join('\n')}
        placeholder={'example.com\n*.example.com'}
        onChange={e => onChange(e.target.value.split('\n'))}
      />
    </section>
  );
}
