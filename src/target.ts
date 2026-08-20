import { embedded, rtc } from './target/config';
import connectRtc from './target/connectRtc';
import connectServer from './target/connectServer';
import connectIframe from './target/connectIframe';
import { installNetworkHook } from './target/networkHook';
import chobitsu from 'chobitsu';

// 必须早于业务请求执行，晚装的请求无法被 mock
installNetworkHook();

if (!embedded) {
  if (rtc) {
    connectRtc();
  } else {
    connectServer();
  }
} else {
  connectIframe();
}

module.exports = {
  chobitsu,
};
