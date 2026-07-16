/**
 * @vitest-environment happy-dom
 */
import { createPlayerButton } from './player-button.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelector('#openlingo-yt-button-styles')?.remove();
  vi.restoreAllMocks();
});

describe('createPlayerButton', () => {
  it('keeps an open menu mounted for progress-only state updates', () => {
    document.body.innerHTML = '<div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div>';
    const handle = createPlayerButton(
      {
        onToggleEnabled: vi.fn(),
        onOpenOptions: vi.fn(),
        onEnableCaptions: vi.fn(),
        onHideButton: vi.fn(),
        onDownloadSrt: vi.fn(),
        onOpenPopup: vi.fn(),
      },
      {
        enabled: true,
        status: 'translating',
        statusText: '0 / 20 cues',
        needsCaptions: false,
        captionSource: 'ai',
        canDownloadSrt: false,
        asrFallback: false,
        asrRunning: false,
      },
    );

    document.querySelector<HTMLButtonElement>('#openlingo-yt-button')?.click();
    const menu = document.querySelector('#openlingo-yt-menu');
    expect(menu).not.toBeNull();

    handle.setState({ statusText: '1 / 20 cues' });
    expect(document.querySelector('#openlingo-yt-menu')).toBe(menu);

    handle.destroy();
  });
});
