import 'webextension-polyfill';
import { registerTranslatorMessageHandlers } from './translator.js';
import { registerYouTubeWatcher } from './youtube-watcher.js';

registerTranslatorMessageHandlers();
registerYouTubeWatcher();

console.log('Background loaded — translator + YouTube watcher ready');
