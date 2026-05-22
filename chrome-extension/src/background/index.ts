import 'webextension-polyfill';
import { registerTranslatorMessageHandlers } from './translator.js';

registerTranslatorMessageHandlers();

console.log('Background loaded — translator ready');
