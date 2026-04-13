// X Markdown Exporter - Background Service Worker
// Handles cross-origin image fetching with URL whitelist validation.

const ALLOWED_IMAGE_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com']);

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedSender(sender) {
  if (!sender?.tab?.url) return false;
  try {
    const host = new URL(sender.tab.url).hostname.replace(/^www\./, '');
    return host === 'x.com' || host === 'twitter.com';
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'FETCH_IMAGE') return false;

  if (!isAllowedSender(sender)) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  if (!isAllowedImageUrl(message.url)) {
    sendResponse({ success: false, error: 'URL not in allowed hosts' });
    return false;
  }

  fetchAsBase64(message.url)
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

async function fetchAsBase64(url) {
  let fetchUrl = url;
  if (fetchUrl.includes('pbs.twimg.com') && fetchUrl.includes('/media')) {
    fetchUrl = fetchUrl.replace(/&name=\w+/, '&name=large');
    if (!fetchUrl.includes('name=')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'name=large';
    }
  }

  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  let binary = '';
  const chunkSize = 4096;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
  }

  return {
    base64: btoa(binary),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}
