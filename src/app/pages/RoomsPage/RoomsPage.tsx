import { useEffect, useState } from 'react';
import useRooms from '../../hooks/useRooms';
import { useAppShell } from '../../AppShell';
import { RoomInfo, fetchAllRooms } from '../../api';
import { formatRelativeTime } from '../../utils/timeUtils';
import styles from './RoomsPage.module.css';

export default function RoomsPage() {
  const rooms = useRooms();
  const shell = useAppShell();
  const [joinInput, setJoinInput] = useState('');
  const [allRooms, setAllRooms] = useState<RoomInfo[]>([]);

  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      fetchAllRooms().then(
        list => {
          if (!stopped) setAllRooms(list);
        },
        () => {
          // 轮询失败保留现有列表
        }
      );
    };
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const doJoin = () => {
    const id = joinInput.trim();
    if (!id) return;
    rooms.join(id);
    setJoinInput('');
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>加入房间</h3>
        <p className={styles.cardDesc}>
          输入他人分享的 RoomID 即可加入对应房间；或新建一个房间，在「我的」页展示二维码供设备扫码绑定。
        </p>
        <div className={styles.joinRow}>
          <input
            className={styles.input}
            value={joinInput}
            placeholder="输入 RoomID"
            onChange={e => setJoinInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') doJoin();
            }}
          />
          <button className={styles.btn} onClick={doJoin}>
            加入
          </button>
          <button className={styles.btnGhost} onClick={rooms.create}>
            新建房间
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>所有房间</h3>
        <p className={styles.cardDesc}>
          展示服务端所有房间。切换当前房间后，「在线调试」「记录」「我的」三页均以该房间为准。
        </p>
        {allRooms.length === 0 ? (
          <p className={styles.empty}>暂无房间</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>房间</th>
                  <th className={styles.th}>RoomID</th>
                  <th className={`${styles.th} ${styles.thCenter}`}>在线设备</th>
                  <th className={styles.th}>上次活跃</th>
                  <th className={`${styles.th} ${styles.thAction}`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {allRooms.map(info => {
                  const id = info.id;
                  const joined = rooms.rooms.indexOf(id) >= 0;
                  const isCurrent = id === rooms.current;
                  const alias = info.alias || '';
                  const count = info.deviceCount;
                  return (
                    <tr
                      key={id}
                      className={`${styles.row} ${
                        isCurrent ? styles.rowActive : ''
                      }`}
                    >
                      <td className={styles.td}>
                        <div className={styles.roomName}>
                          <span className={styles.ellipsis}>
                            {alias || '(未命名房间)'}
                          </span>
                          {isCurrent ? (
                            <span className={styles.tagCurrent}>当前</span>
                          ) : joined ? (
                            <span className={styles.tagJoined}>已加入</span>
                          ) : null}
                        </div>
                      </td>
                      <td className={`${styles.td} ${styles.roomId}`}>{id}</td>
                      <td className={`${styles.td} ${styles.tdCenter}`}>
                        <span
                          className={`${styles.deviceCount} ${
                            count > 0 ? styles.deviceCountOn : ''
                          }`}
                        >
                          {count > 0 ? `${count} 个会话在线` : '—'}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.lastActive}`}>
                        {formatRelativeTime(info.lastActiveAt)}
                      </td>
                      <td className={`${styles.td} ${styles.tdAction}`}>
                        <div className={styles.roomActions}>
                          {isCurrent ? (
                            <button
                              className={styles.btnGhost}
                              onClick={() => shell.setActiveNav('targets')}
                            >
                              查看设备
                            </button>
                          ) : joined ? (
                            <button
                              className={styles.btn}
                              onClick={() => rooms.switchTo(id)}
                            >
                              切换
                            </button>
                          ) : (
                            <button
                              className={styles.btn}
                              onClick={() => rooms.join(id)}
                            >
                              加入
                            </button>
                          )}
                          {joined ? (
                            <button
                              className={styles.btnGhost}
                              onClick={() => rooms.leave(id)}
                              title="仅从我的列表移除，不影响房间本身"
                            >
                              退出
                            </button>
                          ) : null}
                          <button
                            className={styles.btnDanger}
                            onClick={() => {
                              if (
                                window.confirm(
                                  '删除房间将解除该房间内所有设备的绑定，确定删除？'
                                )
                              ) {
                                rooms.del(id);
                              }
                            }}
                            title="删除房间并解除设备绑定"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
