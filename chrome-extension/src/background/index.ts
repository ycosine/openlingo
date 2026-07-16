import 'webextension-polyfill';
import { registerAsrMessageHandlers } from './asr';
import { registerTranslatorMessageHandlers } from './translator';
import { registerYouTubeWatcher } from './youtube-watcher';

registerTranslatorMessageHandlers();
registerYouTubeWatcher();
registerAsrMessageHandlers();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'OL_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage().catch(() => undefined);
    sendResponse({ ok: true });
    return;
  }
  if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'OL_OPEN_POPUP') {
    chrome.action.openPopup?.().catch(() => undefined);
    sendResponse({ ok: true });
    return;
  }
  return;
});

console.log('Background loaded — translator + YouTube watcher ready');
