import type { ComponentType } from 'react';
import TargetsPage from './pages/TargetsPage/TargetsPage';
import LogsPage from './pages/LogsPage/LogsPage';
import SettingsPage from './pages/SettingsPage/SettingsPage';
import RoomsPage from './pages/RoomsPage/RoomsPage';
import MyRoomPage from './pages/MyRoomPage/MyRoomPage';

export interface NavDef {
  key: string;
  label: string;
  page: ComponentType;
}

export const NAV_DEFS: NavDef[] = [
  { key: 'targets', label: '在线调试', page: TargetsPage },
  { key: 'logs', label: '记录', page: LogsPage },
  { key: 'rooms', label: '房间', page: RoomsPage },
  { key: 'mine', label: '我的', page: MyRoomPage },
  { key: 'settings', label: '设置', page: SettingsPage },
];

export const DEFAULT_NAV = NAV_DEFS[0].key;

export function navFromHash(): string | null {
  const key = (location.hash || '').replace(/^#\/?/, '').split(/[?&]/)[0];
  return NAV_DEFS.some(n => n.key === key) ? key : null;
}
