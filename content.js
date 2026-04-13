// X Markdown Exporter - Entry Point
// Message listener, orchestration, and initialization.

(function () {
  'use strict';

  const _XPD = window._XPD;
  const core = _XPD.core;
  const exp = _XPD.exp;
  const ui = _XPD.ui;

  const DEFAULT_EXPORT_OPTIONS = Object.freeze({
    includeTime: true,
    includeAuthor: true,
    includeStats: false,
    includeComments: false,
  });

  // Progress bridge

  function sendProgress(text) {
    ui.updateProgressText(text);
    chrome.runtime.sendMessage({ type: 'XPD_PROGRESS', text }).catch(() => {});
  }

  // Expose sendProgress so core and export modules can call it.
  _XPD.sendProgress = sendProgress;

  // Options normalization

  /**
   * Merge caller options with defaults.
   * Currently the UI does not expose includeAuthor / includeTime toggles,
   * so they always default to true via DEFAULT_EXPORT_OPTIONS.
   * When UI toggles are added, they will flow through naturally.
   */
  function normalizeOptions(options) {
    return { ...DEFAULT_EXPORT_OPTIONS, ...(options || {}) };
  }

  // Core extract-and-download orchestrator

  async function handleExtractAndDownload(options, mode) {
    const exportOptions = normalizeOptions(options);
    exportOptions.isArticle = core.detectArticlePage();
    exportOptions.sourceUrl = core.getSourceUrl();

    sendProgress('正在查找内容...');

    console.log('[XPD] Page type:', exportOptions.isArticle ? 'ARTICLE' : 'TWEET');

    let textData;
    let author;
    let time;
    let stats;
    let threadTweets;

    if (exportOptions.isArticle) {
      const articleData = core.extractArticle();
      core.validateExtracted(articleData, 'Note 页面');
      textData = { t: articleData.text, imgs: articleData.images };
      author = articleData.author;
      time = articleData.time;
      stats = { replies: '0', retweets: '0', likes: '0' };
      threadTweets = [];
    } else {
      const mainTweetEl = core.getMainTweet();
      if (!mainTweetEl) {
        throw new core.ExtractionError(
          'MAIN_TWEET_NOT_FOUND',
          `未找到当前推文正文。请先打开推文详情页后重试；如果仍然失败，请到 GitHub 提 Issue: ${core.GITHUB_ISSUES_URL}`
        );
      }

      sendProgress('正在提取正文...');
      textData = core.extractRichContent(mainTweetEl);
      core.validateExtracted(textData, '推文');
      author = core.extractAuthorInfo(mainTweetEl);
      time = core.extractTime(mainTweetEl);
      stats = core.extractStats(mainTweetEl);
      threadTweets = core.extractThreadTweets(mainTweetEl);
    }

    console.log('[XPD] Extracted:', {
      textLen: textData.t.length,
      images: textData.imgs.length,
      thread: threadTweets.length,
    });

    const titleText = core.deriveTitleText(textData.t);

    if (mode === 'zip') {
      await exp.downloadAsZip(titleText, textData, author, time, stats, threadTweets, exportOptions);
    } else if (mode === 'embed') {
      await exp.downloadAsEmbed(titleText, textData, author, time, stats, threadTweets, exportOptions);
    } else {
      exp.downloadAsLink(titleText, textData, author, time, stats, threadTweets, exportOptions);
    }

    return { success: true };
  }

  // Expose so UI module can call it from the floating panel download button.
  _XPD.handleExtractAndDownload = handleExtractAndDownload;

  // Message listener

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: ui.evaluatePageAvailability().ready });
      return false;
    }

    if (message.type === 'EXTRACT_AND_DOWNLOAD') {
      ui.beginUiWork();
      handleExtractAndDownload(message.options, message.mode)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error('[XPD] Error:', error);
          sendResponse({ success: false, error: error.message });
        })
        .finally(() => {
          ui.endUiWork();
          ui.refreshPanelStatus();
        });
      return true;
    }

    return false;
  });

  // Bootstrap

  ui.initFloatingUi();
  ui.startUrlWatcher();
  ui.schedulePanelStatusRefresh();

  console.log('[XPD] X Markdown Exporter content script loaded');
})();
