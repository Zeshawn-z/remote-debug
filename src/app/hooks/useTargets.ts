import { useEffect, useState } from 'react';
import toInt from 'licia/toInt';
import { Target, fetchTargets, fetchTimestamp } from '../api';

// 每 2s 比对时间戳，变化才重新拉列表
export default function useTargets(): Target[] {
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    let start = Date.now();
    let stopped = false;

    const refresh = () => {
      fetchTargets().then(list => {
        if (!stopped) {
          setTargets(list);
        }
      });
    };

    refresh();

    const timer = setInterval(() => {
      if (document.hidden) {
        return;
      }
      fetchTimestamp().then(timestamp => {
        if (toInt(timestamp) > start) {
          start = toInt(timestamp);
          refresh();
        }
      });
    }, 2000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return targets;
}
