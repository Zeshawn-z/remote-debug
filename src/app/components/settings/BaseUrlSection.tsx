import styles from './Settings.module.css';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

// 服务对外访问基地址配置
export default function BaseUrlSection({ value, onChange }: Props) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.h2}>访问基地址</h2>
          <p className={styles.desc}>
            服务对外可访问的基地址，多处会用到它，包括「我的」页二维码绑定链接、帮助里的手动注入脚本等。
            留空则使用服务启动参数中的地址。
          </p>
        </div>
      </header>
      <input
        className={styles.input}
        style={{ maxWidth: 480 }}
        value={value}
        placeholder="https://chii.example.com"
        onChange={e => onChange(e.target.value)}
      />
    </section>
  );
}
