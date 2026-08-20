// 解析 target 上报的 ChiiLog.entry，转为日志条目

const MAX_TEXT_LEN = 64 * 1024;

function clamp(s) {
  if (typeof s !== 'string') return '';
  if (s.length <= MAX_TEXT_LEN) return s;
  return s.slice(0, MAX_TEXT_LEN) + `…<truncated ${s.length - MAX_TEXT_LEN} chars>`;
}

// 非 ChiiLog.entry 返回 null
module.exports = function parseCdpMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!msg || msg.method !== 'ChiiLog.entry') {
    return null;
  }
  const params = msg.params || {};
  const entry = {
    time: typeof params.timestamp === 'number' ? params.timestamp : Date.now(),
    type: params.type || 'log',
    text: clamp(typeof params.text === 'string' ? params.text : ''),
  };
  if (params.source && typeof params.source === 'object') {
    entry.source = {
      url: String(params.source.url || ''),
      line: Number(params.source.line || 0),
      column: Number(params.source.column || 0),
      function: params.source.function
        ? String(params.source.function)
        : undefined,
    };
  }
  if (params.sourceLabel) {
    entry.sourceLabel = String(params.sourceLabel);
  }
  return entry;
};
