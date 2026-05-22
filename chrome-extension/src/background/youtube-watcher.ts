/**
 * Watches outgoing requests for YouTube `timedtext` URLs and relays them to
 * the originating tab. Caption tracks are served with signed parameters we
 * cannot reconstruct ourselves, so we hand the URL back to the content script
 * which refetches it with `&fmt=json3` to get a structured cue list.
 */

const TIMEDTEXT_FILTER: chrome.webRequest.RequestFilter = {
  urls: ['*://*.youtube.com/api/timedtext*', '*://www.youtube.com/api/timedtext*'],
  types: ['xmlhttprequest', 'other'],
};

interface TimedtextUrlMessage {
  type: 'YT_TIMEDTEXT_URL';
  url: string;
}

const sendTimedtextUrl = (tabId: number, url: string): void => {
  const msg: TimedtextUrlMessage = { type: 'YT_TIMEDTEXT_URL', url };
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab gone, content script not yet ready, or not a YouTube page — ignore.
  });
};

export const registerYouTubeWatcher = (): void => {
  if (!chrome.webRequest?.onBeforeRequest) return;
  chrome.webRequest.onBeforeRequest.addListener(details => {
    if (details.tabId < 0) return;
    if (!details.url) return;
    // Only forward URLs that actually look like a track fetch (have a `lang`
    // or `caps` query) — YouTube hits the endpoint for other purposes too.
    if (!/[?&](lang|tlang|caps|v)=/.test(details.url)) return;
    sendTimedtextUrl(details.tabId, details.url);
  }, TIMEDTEXT_FILTER);
};
