import { ext } from './lib/browser.js';
import { quickSave } from './lib/quick-save.js';

const MENUS = [
  { id: 'page', title: 'Save page to Enve Memory', contexts: ['page', 'frame'] },
  { id: 'selection', title: 'Save selection to Enve Memory', contexts: ['selection'] },
  { id: 'link', title: 'Save link to Enve Memory', contexts: ['link'] },
];

ext.runtime.onInstalled.addListener(async ({ reason }) => {
  await ext.contextMenus.removeAll();
  for (const menu of MENUS) ext.contextMenus.create(menu);
  if (reason === 'install') await ext.runtime.openOptionsPage();
});

ext.contextMenus.onClicked.addListener((info, tab) => quickSave(String(info.menuItemId), info, tab));

ext.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'quick-save') return;
  const target = tab ?? (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  await quickSave('page', {}, target);
});
