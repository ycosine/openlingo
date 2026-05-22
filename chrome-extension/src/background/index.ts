import 'webextension-polyfill';
import { registerTranslatorMessageHandlers } from './translator.js';
import { registerYouTubeWatcher } from './youtube-watcher.js';

registerTranslatorMessageHandlers();
registerYouTubeWatcher();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'OL_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage().catch(() => undefined);
    sendResponse({ ok: true });
    return;
  }
  return;
});

console.log('Background loaded — translator + YouTube watcher ready');
