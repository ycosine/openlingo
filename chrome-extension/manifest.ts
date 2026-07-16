import { IS_FIREFOX } from '@extension/env';
import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  // Pin the extension ID for Chromium so unpacked/zip installs from any
  // directory keep the same ID, which keeps chrome.storage (and the sync
  // area's cloud copy) attached across reinstalls. Firefox gets a stable ID
  // from browser_specific_settings.gecko.id instead.
  ...(!IS_FIREFOX
    ? {
        key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyCiZy5eJO3f0er1R0gwvgkXud5ZVeD1f99TI6qc8Jetvr5oO2j5FHr3S5kcJUojZhLyHWmtOLevr4kQTfLybl4l8dZaNK6LhU4W3RjOVtIbstxZmueWJ0f1+dwFFwgAH/Es3T71W9Of+rGhKPBQtAneEOtiOWNR4ia5DCNi0tfORdXIXqpseNU/v1UZcvUOyvkVITM97tiNE7+hfilYZY/KYWCIzNhb+X0PIJUlyPeS9RM/hnrPyj75pgS0Rbg5YcqiMnss/CbCiVHCCwaqxOYb231FGc1PHsHICVySmy7tJepuKFyGCDRw9FFeAjT1LNTuaP95OqCZTi4a+4WqkBwIDAQAB',
      }
    : {}),
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
      resources: ['*.js', '*.css', 'icon-128.png', 'icon-34.png', 'options/fonts/*.woff2'],
      matches: ['*://*/*'],
    },
  ],
} satisfies ManifestType;

export default manifest;
