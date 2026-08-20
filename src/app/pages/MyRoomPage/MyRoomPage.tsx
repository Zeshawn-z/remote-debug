import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import useRooms from '../../hooks/useRooms';
import useTargets from '../../hooks/useTargets';
import useDevices from '../../hooks/useDevices';
import { fetchSettings, resolveBaseUrl } from '../../api';
import TargetsPage from '../TargetsPage/TargetsPage';
import DeviceListPopup from '../../components/DeviceListPopup/DeviceListPopup';
import styles from './MyRoomPage.module.css';

declare const window: any;

// 落地页在服务域，与被调试页不同源
function buildBindUrl(baseUrl: string, roomId: string): string {
  const basePath = window.basePath || '/';
  const origin = resolveBaseUrl(baseUrl);
  return `${origin}${basePath}bind?chii_room=${encodeURIComponent(roomId)}`;
}

export default function MyRoomPage() {
  const rooms = useRooms();
  const targets = useTargets();
  const devices = useDevices();
  const { current, currentInfo } = rooms;

  const [aliasInput, setAliasInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    fetchSettings().then(
      s => setBaseUrl(s.baseUrl || ''),
      () => {
        // 留空时回退到当前 origin
      }
    );
  }, []);

  const bindUrl = current ? buildBindUrl(baseUrl, current) : '';

  useEffect(() => {
    setAliasInput(currentInfo ? currentInfo.alias || '' : '');
  }, [currentInfo && currentInfo.alias, current]);

  // 只认当前房间
  const isMine = (roomId?: string) =>
    !!current && (roomId || '') === current;

  const stats = useMemo(() => {
    const mineTargets = targets.filter(t => isMine(t.roomId));
    // 未上报 deviceId 的会话借同 ua 加 ip 的会话推断，同一设备的多个标签页才能合成一台
    const uaKey = (t: (typeof mineTargets)[number]) =>
      `${t.userAgent || ''}|${t.ip || ''}`;
    const uaToDevice = new Map<string, string>();
    mineTargets.forEach(t => {
      if (t.deviceId && !uaToDevice.has(uaKey(t))) {
        uaToDevice.set(uaKey(t), t.deviceId);
      }
    });
    const deviceMap = new Map<string, { id: string; userAgent: string }>();
    mineTargets.forEach(t => {
      const resolvedId = t.deviceId || uaToDevice.get(uaKey(t)) || '';
      const key = resolvedId || `ua:${uaKey(t)}`;
      if (!deviceMap.has(key)) {
        deviceMap.set(key, {
          id: resolvedId || '(未上报)',
          userAgent: t.userAgent || '',
        });
      }
    });
    const mineBound = devices
      .filter(d => isMine(d.roomId))
      .map(d => ({ id: d.id, userAgent: d.userAgent || '' }));
    return {
      sessionCount: mineTargets.length,
      onlineDevices: Array.from(deviceMap.values()),
      boundDevices: mineBound,
    };
  }, [targets, devices, current]);

  const copyId = () => {
    if (!current) return;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current).then(done, done);
    } else {
      done();
    }
  };

  const copyLink = () => {
    if (!bindUrl) return;
    const done = () => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bindUrl).then(done, done);
    } else {
      done();
    }
  };

  const saveAlias = () => {
    if (!current) return;
    rooms.setAlias(current, aliasInput.trim());
    setSavedMsg('已保存');
    setTimeout(() => setSavedMsg(''), 1500);
  };

  if (!current) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.empty}>
            {rooms.ready ? '尚未加入任何房间' : '正在创建房间…'}
          </p>
          {rooms.ready ? (
            <div style={{ textAlign: 'center' }}>
              <button className={styles.btn} onClick={rooms.create}>
                新建房间
              </button>
            </div>
          ) : null}
        </div>
        <TargetsPage mineOnly hideToolbar />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.minecard}>
        <h3 className={styles.cardTitle}>我的房间</h3>
        <p className={styles.cardDesc}>
          在设备调试浮窗中点击「绑定」扫描。加入后，「在线调试」与「记录」页将默认
          只展示本房间内的设备与会话。
        </p>
        <div className={styles.mineLayout}>
          <div>
            <div className={styles.qrBox}>
              <QRCodeSVG value={bindUrl} size={176} level="M" includeMargin={false} />
            </div>
            <div className={styles.qrHint}>扫码绑定设备</div>
          </div>
          <div className={styles.mineInfo}>
            <div className={styles.fieldPair}>
              <div className={`${styles.field} ${styles.fieldId}`}>
                <span className={styles.fieldLabel}>RoomID</span>
                <div className={styles.idRow}>
                  <span className={styles.idValue}>{current}</span>
                  <button className={styles.btnGhost} onClick={copyId}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              <div className={`${styles.field} ${styles.fieldLink}`}>
                <span className={styles.fieldLabel}>绑定链接</span>
                <div className={styles.idRow}>
                  <span className={styles.idValue} title={bindUrl}>
                    {bindUrl}
                  </span>
                  <button className={styles.btnGhost} onClick={copyLink}>
                    {linkCopied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>房间别名</span>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={aliasInput}
                  maxLength={100}
                  placeholder="给房间起个好记的名字"
                  onChange={e => setAliasInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveAlias();
                  }}
                />
                <button className={styles.btn} onClick={saveAlias}>
                  保存
                </button>
                {savedMsg ? <span className={styles.msg}>{savedMsg}</span> : null}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>统计</span>
              <div className={styles.statRow}>
                <DeviceListPopup
                  devices={stats.onlineDevices}
                  emptyText="当前无在线设备"
                >
                  <span className={`${styles.stat} ${styles.statHover}`}>
                    在线设备 <b>{stats.onlineDevices.length}</b> 台
                  </span>
                </DeviceListPopup>
                <span className={styles.stat}>
                  在线会话 <b>{stats.sessionCount}</b> 个
                </span>
                <DeviceListPopup
                  devices={stats.boundDevices}
                  emptyText="暂无已绑定设备"
                >
                  <span className={`${styles.stat} ${styles.statHover}`}>
                    已绑定设备 <b>{stats.boundDevices.length}</b> 台
                  </span>
                </DeviceListPopup>
              </div>
            </div>
          </div>
        </div>
      </div>
      <TargetsPage mineOnly hideToolbar />
    </div>
  );
}
