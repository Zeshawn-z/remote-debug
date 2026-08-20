function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDateTime(t: number): string {
  if (!t) return '—';
  const d = new Date(t);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// 超过 7 天回退到绝对日期
export function formatRelativeTime(t: number): string {
  if (!t) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const day = Math.floor(hour / 24);
  if (day <= 7) return `${day}天前`;
  return formatDateTime(t);
}
