// X Markdown Exporter - Background Service Worker
// Handles cross-origin image and video fetching

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE') {
    fetchAsBase64(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'FETCH_BINARY') {
    fetchAsBase64(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchAsBase64(url) {
  // For Twitter images, get large version
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

  // Convert to base64 in chunks
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
  }

  return {
    base64: btoa(binary),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}
