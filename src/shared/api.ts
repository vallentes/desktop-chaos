import { invoke } from '@tauri-apps/api/core';
import type { EffectId } from './effects';
import type { Bootstrap, ChaosConfig, ChaosStatus, MonitorInfo, ServerStatus, Settings, UpdateInfo } from './types';
import type { Snapshot, Widget, WidgetsState } from './widgets';

export const api = {
  bootstrap: () => invoke<Bootstrap>('get_bootstrap'),
  updateSettings: (patch: Partial<Settings> | Record<string, unknown>) => invoke<Settings>('update_settings', { patch }),
  monitors: () => invoke<MonitorInfo[]>('get_monitors'),
  fire: (effect: EffectId, monitor: number | null = null) => invoke<void>('fire_effect', { effect, monitor }),
  arm: (tool: EffectId) => invoke<void>('arm_tool', { tool }),
  disarm: () => invoke<void>('disarm_tool'),
  clear: (mode: 'instant' | 'fade' = 'instant') => invoke<void>('clear_effects', { mode }),
  stopEverything: () => invoke<void>('stop_everything'),
  startChaos: (config: ChaosConfig) => invoke<ChaosStatus>('start_chaos', { config }),
  stopChaos: () => invoke<void>('stop_chaos'),
  serverStatus: () => invoke<ServerStatus>('server_status'),
  regenerateToken: () => invoke<ServerStatus>('regenerate_token'),
  widgetsState: () => invoke<WidgetsState>('widgets_state'),
  addWidget: (kind: string) => invoke<Widget>('add_widget', { kind }),
  updateWidget: (widget: Widget) => invoke<Widget>('update_widget', { widget }),
  removeWidget: (id: number) => invoke<void>('remove_widget', { id }),
  setEditMode: (on: boolean) => invoke<void>('set_widget_edit_mode', { on }),
  watchSensors: (on: boolean) => invoke<void>('watch_sensors', { on }),
  latestSnapshot: () => invoke<Snapshot | null>('latest_snapshot'),
  createProfile: (name: string, copyCurrent: boolean) => invoke<number>('create_profile', { name, copyCurrent }),
  renameProfile: (id: number, name: string) => invoke<void>('rename_profile', { id, name }),
  deleteProfile: (id: number) => invoke<void>('delete_profile', { id }),
  exportProfile: (id: number) => invoke<boolean>('export_profile', { id }),
  importProfile: () => invoke<number | null>('import_profile'),
  openSupportLink: (kind: 'coffee' | 'revolut') => invoke<void>('open_support_link', { kind }),
  openDataFolder: () => invoke<void>('open_data_folder'),
  checkForUpdate: () => invoke<UpdateInfo | null>('check_for_update'),
  installUpdate: () => invoke<void>('install_update'),
  quit: () => invoke<void>('quit_app'),
};

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
