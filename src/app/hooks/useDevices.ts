import { useEffect, useState } from 'react';
import { DeviceInfo, fetchDevices } from '../api';

// 含离线设备，每 3s 刷新
export default function useDevices(): DeviceInfo[] {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      fetchDevices().then(
        list => {
          if (!stopped) setDevices(list);
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

  return devices;
}
