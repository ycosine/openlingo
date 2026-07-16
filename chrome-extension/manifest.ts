import { IS_FIREFOX } from '@extension/env';
import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  browser_specific_settings: {
    gecko: {
      id: 'openlingo@openlingo.app',
      strict_min_version: '109.0',
    },
  },
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  host_permissions: [
    '<all_urls>',
    'https://api.deepl.com/*',
    'https://api-free.deepl.com/*',
    'https://*.youtube.com/*',
    ...(!IS_FIREFOX ? ['https://api.elevenlabs.io/*'] : []),
  ],
  permissions: IS_FIREFOX
    ? ['storage', 'tabs', 'webRequest']
    : ['storage', 'tabs', 'webRequest', 'tabCapture', 'offscreen'],
  options_page: 'options/index.html',
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  action: {
    default_popup: 'popup/index.html',
    default_icon: 'icon-34.png',
  },
  icons: {
    '128': 'icon-128.png',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*', '<all_urls>'],
      js: ['content/all.iife.js'],
    },
  ],
  web_accessible_resources: [
    {
      resources: ['*.js', '*.css', 'icon-128.png', 'icon-34.png', 'options/fonts/*.ttf'],
      matches: ['*://*/*'],
    },
  ],
} satisfies ManifestType;

export default manifest;
