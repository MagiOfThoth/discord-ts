import fs from 'fs';

export const SETTINGS_FILE = 'settings.json';
export const TARGET_EMOJI = '🛎';
export const RESOLVE_EMOJI = '✅';

export let flaggedMessages: Record<string, string> = {};

export function loadSettings(): Record<string, any> {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

export function saveSettings(data: Record<string, any>) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}