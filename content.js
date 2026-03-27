// X Markdown Exporter - Content Script
// Supports regular tweets, threads, and long-form articles/notes.
// Three download modes: link, embed, zip.
// Preserves document order between text and images.

(function () {
  'use strict';

  const MAX_IMAGE_WIDTH = 1200;
  const JPEG_QUALITY = 0.7;
  const DEFAULT_EXPORT_OPTIONS = Object.freeze({
    includeTime: true,
    includeAuthor: true,
    includeStats: false,
    includeComments: false,
  });
  const POST_DETAIL_URL_RE = /^https:\/\/(x\.com|twitter\.com)\/[^/]+\/(status|i\/web\/status)\/\d+/i;
  const MODE_LABELS = Object.freeze({
    link: '\u94fe\u63a5\u5f15\u7528',
    embed: '\u5185\u5d4c\u56fe\u7247',
    zip: 'ZIP \u6253\u5305',
  });
  const MODE_DESCS = Object.freeze({
    link: '\u56fe\u7247\u4f1a\u4fdd\u7559\u539f\u59cb\u94fe\u63a5\uff0c\u751f\u6210\u7684 Markdown \u6700\u8f7b\u91cf\u3002',
    embed: '\u56fe\u7247\u538b\u7f29\u540e\u4ee5\u5185\u5d4c\u65b9\u5f0f\u5199\u5165 Markdown\uff0c\u5355\u6587\u4ef6\u4fdd\u5b58\u66f4\u7701\u5fc3\u3002',
    zip: 'Markdown \u548c\u56fe\u7247\u4e00\u8d77\u6253\u5305\u6210 ZIP\uff0c\u9002\u5408\u5b8c\u6574\u79bb\u7ebf\u5f52\u6863\u3002',
  });
  const UI_TEXT = Object.freeze({
    launcherTitle: 'X Markdown Exporter\uff0c\u62d6\u52a8\u53ef\u79fb\u52a8',
    title: 'X Markdown Exporter',
    subtitle: '\u4fdd\u5b58\u5f53\u524d\u63a8\u6587\u6216 Note',
    modeTitle: '\u5bfc\u51fa\u6a21\u5f0f',
    checking: '\u68c0\u6d4b\u4e2d...',
    ready: '\u53ef\u4ee5\u4e0b\u8f7d\u5f53\u524d\u5185\u5bb9',
    unsupported: '\u8bf7\u6253\u5f00 X \u63a8\u6587\u8be6\u60c5\u9875\u6216 Note \u9875\u9762',
    notReady: '\u9875\u9762\u8fd8\u6ca1\u51c6\u5907\u597d\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
    note: '\u9ed8\u8ba4\u4f1a\u9644\u5e26\u4f5c\u8005\u548c\u65f6\u95f4\u3002',
    download: '\u4e0b\u8f7d Markdown',
    processing: '\u5904\u7406\u4e2d...',
    refresh: '\u5237\u65b0',
    refreshLoading: '\u6b63\u5728\u5237\u65b0\u9875\u9762...',
    progressDefault: '\u6b63\u5728\u63d0\u53d6\u5185\u5bb9...',
    downloadSuccess: '\u4e0b\u8f7d\u6210\u529f',
    downloadFailed: '\u4e0b\u8f7d\u5931\u8d25',
    close: '\u5173\u95ed',
  });
  const FLOATING_TOP_STORAGE_KEY = 'xpd_float_top';
  const FLOATING_RIGHT_STORAGE_KEY = 'xpd_float_right';
  const FLOATING_DEFAULT_TOP = 104;
  const FLOATING_DEFAULT_RIGHT = 18;
  const FLOATING_DRAG_THRESHOLD = 6;
  const uiState = {
    root: null,
    launcher: null,
    launcherBadge: null,
    panel: null,
    status: null,
    statusText: null,
    modeDesc: null,
    downloadBtn: null,
    refreshBtn: null,
    closeBtn: null,
    progress: null,
    progressText: null,
    result: null,
    toast: null,
    currentMode: 'embed',
    ready: false,
    open: false,
    busyCount: 0,
    lastUrl: window.location.href,
    resultTimer: null,
    toastTimer: null,
    refreshTimers: [],
    floatingTop: FLOATING_DEFAULT_TOP,
    floatingRight: FLOATING_DEFAULT_RIGHT,
    panelSide: 'left',
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartRight: FLOATING_DEFAULT_RIGHT,
    dragStartTop: FLOATING_DEFAULT_TOP,
    dragMoved: false,
    suppressClickUntil: 0,
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: evaluatePageAvailability().ready });
      return false;
    }

    if (message.type === 'EXTRACT_AND_DOWNLOAD') {
      beginUiWork();
      handleExtractAndDownload(message.options, message.mode)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error('[XPD] Error:', error);
          sendResponse({ success: false, error: error.message });
        })
        .finally(() => {
          endUiWork();
          refreshPanelStatus();
        });
      return true;
    }

    return false;
  });

  initFloatingUi();
  startUrlWatcher();
  schedulePanelStatusRefresh();

  async function handleExtractAndDownload(options, mode) {
    const exportOptions = normalizeOptions(options);

    sendProgress('正在查找内容...');

    const isArticle = detectArticlePage();
    console.log('[XPD] Page type:', isArticle ? 'ARTICLE' : 'TWEET');

    let textData;
    let author;
    let time;
    let stats;
    let threadTweets;

    if (isArticle) {
      const articleData = extractArticle();
      textData = { t: articleData.text, imgs: articleData.images };
      author = articleData.author;
      time = articleData.time;
      stats = { replies: '0', retweets: '0', likes: '0' };
      threadTweets = [];
    } else {
      const mainTweetEl = getMainTweet();
      if (!mainTweetEl) throw new Error('未找到当前推文内容');

      sendProgress('正在提取正文...');
      textData = extractRichContent(mainTweetEl);
      author = extractAuthorInfo(mainTweetEl);
      time = extractTime(mainTweetEl);
      stats = extractStats(mainTweetEl);
      threadTweets = extractThreadTweets(mainTweetEl);
    }

    console.log('[XPD] Extracted:', {
      textLen: textData.t.length,
      images: textData.imgs.length,
      thread: threadTweets.length,
    });

    if (!textData.t && textData.imgs.length === 0 && threadTweets.length === 0) {
      throw new Error('没能提取到任何内容，请刷新页面后重试');
    }

    const titleText = deriveTitleText(textData.t);

    if (mode === 'zip') {
      await downloadAsZip(titleText, textData, author, time, stats, threadTweets, exportOptions);
    } else if (mode === 'embed') {
      await downloadAsEmbed(titleText, textData, author, time, stats, threadTweets, exportOptions);
    } else {
      downloadAsLink(titleText, textData, author, time, stats, threadTweets, exportOptions);
    }

    return { success: true };
  }

  function sendProgress(text) {
    updateProgressText(text);
    chrome.runtime.sendMessage({ type: 'XPD_PROGRESS', text }).catch(() => {});
  }

  function normalizeOptions(options) {
    return {
      ...DEFAULT_EXPORT_OPTIONS,
      ...(options || {}),
      includeTime: true,
      includeAuthor: true,
    };
  }

  function initFloatingUi() {
    if (!document.documentElement) return;

    const existingRoot = document.getElementById('xpd-floating-root');
    if (existingRoot) {
      existingRoot.remove();
    }

    const root = document.createElement('div');
    root.id = 'xpd-floating-root';
    root.innerHTML = getFloatingUiMarkup();

    (document.body || document.documentElement).appendChild(root);

    uiState.root = root;
    uiState.launcher = root.querySelector('[data-role="launcher"]');
    uiState.launcherBadge = root.querySelector('[data-role="launcherBadge"]');
    uiState.panel = root.querySelector('[data-role="panel"]');
    uiState.status = root.querySelector('[data-role="status"]');
    uiState.statusText = root.querySelector('[data-role="statusText"]');
    uiState.modeDesc = root.querySelector('[data-role="modeDesc"]');
    uiState.downloadBtn = root.querySelector('[data-role="downloadBtn"]');
    uiState.refreshBtn = root.querySelector('[data-role="refreshBtn"]');
    uiState.closeBtn = root.querySelector('[data-role="closeBtn"]');
    uiState.progress = root.querySelector('[data-role="progress"]');
    uiState.progressText = root.querySelector('[data-role="progressText"]');
    uiState.result = root.querySelector('[data-role="result"]');
    uiState.toast = root.querySelector('[data-role="toast"]');
    uiState.currentMode = getSavedMode();
    const savedFloatingPosition = getSavedFloatingPosition();
    uiState.floatingTop = savedFloatingPosition.top;
    uiState.floatingRight = savedFloatingPosition.right;

    root.addEventListener('pointerdown', stopUiPropagation);
    root.addEventListener('click', stopUiPropagation);

    uiState.launcher.addEventListener('click', handleLauncherClick);
    uiState.launcher.addEventListener('pointerdown', handleLauncherPointerDown);
    uiState.launcher.addEventListener('pointermove', handleLauncherPointerMove);
    uiState.launcher.addEventListener('pointerup', handleLauncherPointerEnd);
    uiState.launcher.addEventListener('pointercancel', handleLauncherPointerEnd);
    uiState.closeBtn.addEventListener('click', () => setPanelOpen(false));
    uiState.refreshBtn.addEventListener('click', handleRefreshClick);
    uiState.downloadBtn.addEventListener('click', handleFloatingDownload);

    root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        updateModeUi(button.dataset.mode);
      });
    });

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    window.addEventListener('resize', handleViewportResize, true);

    updateModeUi(uiState.currentMode);
    applyFloatingPosition(
      { top: uiState.floatingTop, right: uiState.floatingRight },
      { persist: false, includePanel: false }
    );
    updateProgressText(UI_TEXT.progressDefault);
    clearResult();
    syncUiControls();
  }

  function getFloatingUiMarkup() {
    return `
      <section class="xpd-panel" data-role="panel" aria-hidden="true">
        <div class="xpd-panel__inner">
          <div class="xpd-header">
            <div>
              <h2 class="xpd-header__title">${UI_TEXT.title}</h2>
              <p class="xpd-header__meta">${UI_TEXT.subtitle}</p>
            </div>
            <button class="xpd-close" data-role="closeBtn" type="button" aria-label="${UI_TEXT.close}" title="${UI_TEXT.close}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"></path>
              </svg>
            </button>
          </div>

          <div class="xpd-status xpd-status--loading" data-role="status">
            <span class="xpd-status__dot"></span>
            <span data-role="statusText">${UI_TEXT.checking}</span>
          </div>

          <div class="xpd-mode-card">
            <div class="xpd-section-title">${UI_TEXT.modeTitle}</div>

            <div class="xpd-mode-selector">
              <button class="xpd-mode-btn" data-mode="link" type="button">${MODE_LABELS.link}</button>
              <button class="xpd-mode-btn" data-mode="embed" type="button">${MODE_LABELS.embed}</button>
              <button class="xpd-mode-btn" data-mode="zip" type="button">${MODE_LABELS.zip}</button>
            </div>

            <p class="xpd-mode-desc" data-role="modeDesc"></p>
          </div>

          <div class="xpd-note">${UI_TEXT.note}</div>

          <div class="xpd-actions">
            <button class="xpd-btn xpd-btn--primary" data-role="downloadBtn" type="button">${UI_TEXT.download}</button>
            <button class="xpd-btn xpd-btn--secondary" data-role="refreshBtn" type="button">${UI_TEXT.refresh}</button>
          </div>

          <div class="xpd-progress" data-role="progress">
            <span class="xpd-spinner" aria-hidden="true"></span>
            <span data-role="progressText">${UI_TEXT.progressDefault}</span>
          </div>

          <div class="xpd-result" data-role="result"></div>
        </div>
      </section>

      <button class="xpd-launcher" data-role="launcher" type="button" aria-label="${UI_TEXT.launcherTitle}" aria-expanded="false" title="${UI_TEXT.launcherTitle}">
        <span class="xpd-launcher__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"></path>
          </svg>
        </span>
        <span class="xpd-launcher__badge" data-role="launcherBadge" data-state="loading"></span>
      </button>

      <div class="xpd-toast" data-role="toast"></div>
    `;
  }

  function getSavedMode() {
    const savedMode = localStorage.getItem('xpd_mode');
    return MODE_DESCS[savedMode] ? savedMode : 'embed';
  }

  function updateModeUi(mode) {
    if (!MODE_DESCS[mode]) return;

    uiState.currentMode = mode;
    localStorage.setItem('xpd_mode', mode);

    if (uiState.root) {
      uiState.root.querySelectorAll('[data-mode]').forEach((button) => {
        button.classList.toggle('xpd-active', button.dataset.mode === mode);
      });
    }

    if (uiState.modeDesc) {
      uiState.modeDesc.textContent = MODE_DESCS[mode];
    }
  }

  function stopUiPropagation(event) {
    event.stopPropagation();
  }

  function handleLauncherClick() {
    if (Date.now() < uiState.suppressClickUntil) {
      return;
    }

    const nextOpen = !uiState.open;
    setPanelOpen(nextOpen);
    if (nextOpen) {
      refreshPanelStatus();
    }
  }

  function setPanelOpen(nextOpen) {
    uiState.open = Boolean(nextOpen);

    if (uiState.root) {
      uiState.root.classList.toggle('xpd-open', uiState.open);
    }
    if (uiState.panel) {
      uiState.panel.setAttribute('aria-hidden', String(!uiState.open));
    }
    if (uiState.launcher) {
      uiState.launcher.setAttribute('aria-expanded', String(uiState.open));
    }

    if (uiState.open) {
      window.requestAnimationFrame(() => {
        applyFloatingPosition(
          { top: uiState.floatingTop, right: uiState.floatingRight },
          { persist: false, includePanel: true }
        );
      });
    }
  }

  function handleLauncherPointerDown(event) {
    if (event.button !== 0) return;

    uiState.dragPointerId = event.pointerId;
    uiState.dragStartX = event.clientX;
    uiState.dragStartY = event.clientY;
    uiState.dragStartRight = uiState.floatingRight;
    uiState.dragStartTop = uiState.floatingTop;
    uiState.dragMoved = false;

    if (uiState.launcher && uiState.launcher.setPointerCapture) {
      uiState.launcher.setPointerCapture(event.pointerId);
    }
  }

  function handleLauncherPointerMove(event) {
    if (event.pointerId !== uiState.dragPointerId) return;

    const deltaX = event.clientX - uiState.dragStartX;
    const deltaY = event.clientY - uiState.dragStartY;
    if (
      !uiState.dragMoved &&
      Math.hypot(deltaX, deltaY) < FLOATING_DRAG_THRESHOLD
    ) {
      return;
    }

    if (!uiState.dragMoved) {
      uiState.dragMoved = true;
      if (uiState.root) {
        uiState.root.classList.add('xpd-dragging');
      }
      if (uiState.open) {
        setPanelOpen(false);
      }
    }

    event.preventDefault();
    applyFloatingPosition(
      {
        top: uiState.dragStartTop + deltaY,
        right: uiState.dragStartRight - deltaX,
      },
      { persist: false, includePanel: false }
    );
  }

  function handleLauncherPointerEnd(event) {
    if (event.pointerId !== uiState.dragPointerId) return;

    if (uiState.launcher && uiState.launcher.hasPointerCapture?.(event.pointerId)) {
      uiState.launcher.releasePointerCapture(event.pointerId);
    }

    if (uiState.dragMoved) {
      uiState.suppressClickUntil = Date.now() + 250;
      saveFloatingPosition(uiState.floatingTop, uiState.floatingRight);
    }

    if (uiState.root) {
      uiState.root.classList.remove('xpd-dragging');
    }

    uiState.dragPointerId = null;
    uiState.dragMoved = false;
  }

  function handleDocumentPointerDown(event) {
    if (!uiState.open || !uiState.root) return;
    if (uiState.root.contains(event.target)) return;
    setPanelOpen(false);
  }

  function handleDocumentKeydown(event) {
    if (event.key === 'Escape' && uiState.open) {
      setPanelOpen(false);
    }
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      schedulePanelStatusRefresh();
    }
  }

  function handleViewportResize() {
    applyFloatingPosition(
      { top: uiState.floatingTop, right: uiState.floatingRight },
      {
        persist: false,
        includePanel: uiState.open,
      }
    );
  }

  function handleRefreshClick() {
    setStatus('loading', UI_TEXT.refreshLoading);
    window.location.reload();
  }

  async function handleFloatingDownload() {
    const availability = refreshPanelStatus();
    if (!availability.ready) {
      showResult('error', availability.message);
      showToast('error', availability.message);
      return;
    }

    beginUiWork();

    try {
      const response = await handleExtractAndDownload(
        {
          includeAuthor: true,
          includeTime: true,
          includeStats: false,
          includeComments: false,
        },
        uiState.currentMode
      );

      if (response && response.success) {
        showResult('success', UI_TEXT.downloadSuccess);
        showToast('success', UI_TEXT.downloadSuccess);
      } else {
        const message = response?.error || UI_TEXT.downloadFailed;
        showResult('error', message);
        showToast('error', message);
      }
    } catch (error) {
      const message = error?.message
        ? `${UI_TEXT.downloadFailed}: ${error.message}`
        : UI_TEXT.downloadFailed;
      showResult('error', message);
      showToast('error', message);
    } finally {
      endUiWork();
      refreshPanelStatus();
    }
  }

  function beginUiWork() {
    uiState.busyCount += 1;
    clearResult();
    syncUiControls();
  }

  function endUiWork() {
    uiState.busyCount = Math.max(0, uiState.busyCount - 1);
    if (uiState.busyCount === 0) {
      updateProgressText(UI_TEXT.progressDefault);
    }
    syncUiControls();
  }

  function syncUiControls() {
    const isBusy = uiState.busyCount > 0;

    if (uiState.downloadBtn) {
      uiState.downloadBtn.disabled = isBusy || !uiState.ready;
      uiState.downloadBtn.textContent = isBusy ? UI_TEXT.processing : UI_TEXT.download;
    }

    if (uiState.progress) {
      uiState.progress.classList.toggle('xpd-show', isBusy);
    }

    if (uiState.launcher) {
      uiState.launcher.classList.toggle('xpd-busy', isBusy);
    }
  }

  function updateProgressText(text) {
    if (uiState.progressText) {
      uiState.progressText.textContent = text || UI_TEXT.progressDefault;
    }
  }

  function showResult(type, text) {
    if (!uiState.result) return;

    if (uiState.resultTimer) {
      window.clearTimeout(uiState.resultTimer);
    }

    uiState.result.className = `xpd-result xpd-result--${type} xpd-show`;
    uiState.result.textContent = text;
    uiState.resultTimer = window.setTimeout(() => {
      clearResult();
    }, 4000);
  }

  function clearResult() {
    if (!uiState.result) return;

    if (uiState.resultTimer) {
      window.clearTimeout(uiState.resultTimer);
      uiState.resultTimer = null;
    }

    uiState.result.className = 'xpd-result';
    uiState.result.textContent = '';
  }

  function showToast(type, text) {
    if (!uiState.toast) return;

    if (uiState.toastTimer) {
      window.clearTimeout(uiState.toastTimer);
    }

    uiState.toast.className = `xpd-toast xpd-toast--${type} xpd-show`;
    uiState.toast.textContent = text;
    uiState.toastTimer = window.setTimeout(() => {
      hideToast();
    }, 3200);
  }

  function hideToast() {
    if (!uiState.toast) return;

    if (uiState.toastTimer) {
      window.clearTimeout(uiState.toastTimer);
      uiState.toastTimer = null;
    }

    uiState.toast.className = 'xpd-toast';
    uiState.toast.textContent = '';
  }

  function setStatus(type, text) {
    if (uiState.status) {
      uiState.status.className = `xpd-status xpd-status--${type}`;
    }
    if (uiState.statusText) {
      uiState.statusText.textContent = text;
    }
    if (uiState.launcherBadge) {
      uiState.launcherBadge.dataset.state = type;
    }
  }

  function evaluatePageAvailability() {
    if (detectArticlePage()) {
      return { ready: true, loading: false, message: UI_TEXT.ready };
    }

    if (POST_DETAIL_URL_RE.test(window.location.href)) {
      if (getMainTweet()) {
        return { ready: true, loading: false, message: UI_TEXT.ready };
      }
      return { ready: false, loading: true, message: UI_TEXT.notReady };
    }

    return { ready: false, loading: false, message: UI_TEXT.unsupported };
  }

  function refreshPanelStatus() {
    const availability = evaluatePageAvailability();
    uiState.ready = availability.ready;

    setStatus(
      availability.ready ? 'ok' : availability.loading ? 'loading' : 'no',
      availability.message
    );
    syncUiControls();

    return availability;
  }

  function schedulePanelStatusRefresh() {
    clearScheduledPanelRefreshes();

    [0, 700, 1600].forEach((delay) => {
      const timerId = window.setTimeout(() => {
        refreshPanelStatus();
        uiState.refreshTimers = uiState.refreshTimers.filter((id) => id !== timerId);
      }, delay);
      uiState.refreshTimers.push(timerId);
    });
  }

  function clearScheduledPanelRefreshes() {
    uiState.refreshTimers.forEach((timerId) => window.clearTimeout(timerId));
    uiState.refreshTimers = [];
  }

  function getSavedFloatingPosition() {
    const savedTop = Number(localStorage.getItem(FLOATING_TOP_STORAGE_KEY));
    const savedRight = Number(localStorage.getItem(FLOATING_RIGHT_STORAGE_KEY));

    return clampFloatingPosition(
      {
        top: Number.isFinite(savedTop) ? savedTop : FLOATING_DEFAULT_TOP,
        right: Number.isFinite(savedRight) ? savedRight : FLOATING_DEFAULT_RIGHT,
      },
      false
    );
  }

  function saveFloatingPosition(top, right) {
    localStorage.setItem(FLOATING_TOP_STORAGE_KEY, String(Math.round(top)));
    localStorage.setItem(FLOATING_RIGHT_STORAGE_KEY, String(Math.round(right)));
  }

  function getFloatingPadding() {
    return window.innerWidth <= 760 ? 12 : 18;
  }

  function getLauncherMetrics() {
    return {
      width: uiState.launcher?.offsetWidth || 48,
      height: uiState.launcher?.offsetHeight || 48,
    };
  }

  function getPanelGap() {
    return window.innerWidth <= 760 ? 8 : 10;
  }

  function clampFloatingPosition(position, includePanel) {
    const padding = getFloatingPadding();
    const { width: launcherWidth, height: launcherHeight } = getLauncherMetrics();
    const floatingHeight = includePanel
      ? Math.max(uiState.panel?.offsetHeight || 336, launcherHeight)
      : launcherHeight;
    const maxTop = Math.max(padding, window.innerHeight - floatingHeight - padding);
    const maxRight = Math.max(padding, window.innerWidth - launcherWidth - padding);

    return {
      top: Math.min(Math.max(position.top, padding), maxTop),
      right: Math.min(Math.max(position.right, padding), maxRight),
    };
  }

  function updatePanelPlacement() {
    if (!uiState.root) return;

    const padding = getFloatingPadding();
    const gap = getPanelGap();
    const { width: launcherWidth } = getLauncherMetrics();
    const viewportWidth = window.innerWidth;
    const maxPanelWidth = Math.min(300, Math.max(180, viewportWidth - padding * 2));
    const availableLeft = Math.max(
      180,
      viewportWidth - uiState.floatingRight - launcherWidth - gap - padding
    );
    const availableRight = Math.max(180, uiState.floatingRight - gap - padding);
    const nextSide =
      availableLeft >= maxPanelWidth || availableLeft >= availableRight ? 'left' : 'right';
    const availableForSide = nextSide === 'left' ? availableLeft : availableRight;
    const nextWidth = Math.max(180, Math.min(maxPanelWidth, availableForSide));

    uiState.panelSide = nextSide;
    uiState.root.classList.toggle('xpd-panel-side-left', nextSide === 'left');
    uiState.root.classList.toggle('xpd-panel-side-right', nextSide === 'right');
    uiState.root.style.setProperty('--xpd-panel-gap', `${gap}px`);
    uiState.root.style.setProperty('--xpd-panel-width', `${Math.round(nextWidth)}px`);
  }

  function applyFloatingPosition(position, options = {}) {
    const includePanel = Boolean(options.includePanel);
    const nextPosition = clampFloatingPosition(position, includePanel);

    uiState.floatingTop = nextPosition.top;
    uiState.floatingRight = nextPosition.right;

    if (uiState.root) {
      uiState.root.style.top = `${Math.round(nextPosition.top)}px`;
      uiState.root.style.right = `${Math.round(nextPosition.right)}px`;
      uiState.root.style.left = 'auto';
      uiState.root.style.bottom = 'auto';
    }

    updatePanelPlacement();

    if (options.persist !== false) {
      saveFloatingPosition(nextPosition.top, nextPosition.right);
    }

    return nextPosition;
  }

  function startUrlWatcher() {
    window.setInterval(() => {
      if (window.location.href === uiState.lastUrl) return;

      uiState.lastUrl = window.location.href;
      uiState.ready = false;
      setStatus('loading', UI_TEXT.checking);
      syncUiControls();
      clearResult();
      hideToast();
      applyFloatingPosition(
        { top: uiState.floatingTop, right: uiState.floatingRight },
        { persist: false, includePanel: uiState.open }
      );
      schedulePanelStatusRefresh();
    }, 800);
  }

  function stripImageMarkdown(text) {
    return (text || '')
      .replace(/!\[[^\]]*\]\(__IMG_\d+__\)/g, '\n')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '\n');
  }

  function stripMarkdownSyntax(text) {
    return (text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeImageLabel(text) {
    return /^(image|图片)\s*\d*$/i.test((text || '').trim());
  }

  function deriveTitleText(markdownText) {
    const imageFreeText = stripImageMarkdown(markdownText);
    const lines = imageFreeText
      .split(/\n+/)
      .map((line) => stripMarkdownSyntax(line))
      .filter((line) => line && !looksLikeImageLabel(line));

    const fallbackTitle = stripMarkdownSyntax(
      (document.title || '').replace(/\s*[|｜/-]\s*X\s*$/i, '')
    );
    const title = lines[0] || stripMarkdownSyntax(imageFreeText) || fallbackTitle || 'Post';

    return title.substring(0, 100).trim();
  }

  function detectArticlePage() {
    const articleContainers = document.querySelectorAll(
      '[data-testid="article-content"], ' +
      '[data-testid="noteContent"], ' +
      '[data-testid="richTextContainer"]'
    );
    if (articleContainers.length > 0) return true;

    const mainContent = document.querySelector('main[role="main"]');
    if (!mainContent) return false;

    const articles = mainContent.querySelectorAll('article[data-testid="tweet"]');
    if (articles.length === 0) return false;

    const firstArticle = articles[0];
    const textBlocks = firstArticle.querySelectorAll('[data-testid="tweetText"]');
    if (textBlocks.length > 2) return true;

    const mainTimeline = mainContent.querySelector('[data-testid="primaryColumn"]') || mainContent;
    const richTextSections = mainTimeline.querySelectorAll(
      'div[lang] > span, ' +
      'div[data-block="true"], ' +
      'div[class*="DraftEditor"], ' +
      'div[class*="public-DraftEditor"]'
    );
    if (richTextSections.length > 3) return true;

    return false;
  }

  function extractArticle() {
    sendProgress('正在提取长文内容...');

    let text = '';
    let images = [];
    let author = { displayName: 'Unknown', handle: '@unknown' };
    let time = null;

    const firstArticle = document.querySelector('article[data-testid="tweet"]');
    if (firstArticle) {
      author = extractAuthorInfo(firstArticle);
      time = extractTime(firstArticle);
    }

    const knownContainers = document.querySelectorAll(
      '[data-testid="article-content"], ' +
      '[data-testid="noteContent"], ' +
      '[data-testid="richTextContainer"]'
    );

    if (knownContainers.length > 0) {
      for (const container of knownContainers) {
        const { t, imgs } = extractRichContent(container, images.length);
        text += t + '\n\n';
        images.push(...imgs);
      }
    }

    if (!text.trim()) {
      console.log('[XPD] Trying broad content extraction...');
      const primaryColumn = document.querySelector('[data-testid="primaryColumn"]') || document.body;
      const { t, imgs } = extractRichContent(primaryColumn, images.length);
      text = t;
      images = imgs;
    }

    return { text: text.trim(), images, author, time };
  }

  function extractRichContent(container, imageOffset = 0) {
    let text = '';
    const images = [];
    const seenCardLinks = new Set();
    let imgIndex = imageOffset;

    const elements = container.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, li, blockquote, ' +
      '[data-testid="tweetText"], ' +
      '[data-testid="tweetPhoto"] img, ' +
      'img[src*="pbs.twimg.com/media"], ' +
      'div[lang], ' +
      'div[data-block="true"], ' +
      'a[href]'
    );

    for (const el of elements) {
      let skip = false;
      for (const other of elements) {
        if (other !== el && other.contains(el)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      const tag = el.tagName.toLowerCase();

      if (tag === 'a') {
        const cardMarkdown = buildPreviewCardMarkdown(el, seenCardLinks);
        if (cardMarkdown) {
          text += `${cardMarkdown}\n\n`;
        }
        continue;
      }

      if (tag === 'img') {
        let src = el.src;
        if (!src || src.includes('profile_images') || src.includes('emoji') || src.includes('icon')) {
          continue;
        }

        src = upgradeImageUrl(src);
        if (!images.includes(src)) {
          images.push(src);
          text += `\n\n![图片${imgIndex + 1}](__IMG_${imgIndex}__)\n\n`;
          imgIndex += 1;
        }
        continue;
      }

      const content = walkTextNode(el);
      if (!content) continue;

      if (tag === 'h1') text += `# ${content}\n\n`;
      else if (tag === 'h2') text += `## ${content}\n\n`;
      else if (tag === 'h3') text += `### ${content}\n\n`;
      else if (tag === 'h4') text += `#### ${content}\n\n`;
      else if (tag === 'blockquote') text += `> ${content.replace(/\n/g, '\n> ')}\n\n`;
      else if (tag === 'li') text += `- ${content}\n`;
      else text += content + '\n\n';
    }

    return { t: text.trim(), imgs: images };
  }

  function buildPreviewCardMarkdown(anchor, seenCardLinks) {
    if (!isPreviewCardAnchor(anchor)) return '';

    const url = normalizeAnchorUrl(anchor.getAttribute('href') || anchor.href || '');
    if (!url || seenCardLinks.has(url)) return '';
    seenCardLinks.add(url);

    const texts = collectPreviewCardTexts(anchor);
    const domain = deriveCardDomain(url, texts);
    const title = sanitizeCardText(
      texts.find((text) => !isLikelyDomainText(text) && text.length >= 4) ||
      domain ||
      url
    );
    const summary = sanitizeCardText(
      texts.find((text) => text !== title && !isLikelyDomainText(text))
    );

    let markdown = `[${escapeMarkdownLinkLabel(title)}](<${url}>)`;
    if (summary) {
      markdown += `\n> ${summary}`;
    }
    if (domain && domain !== title && domain !== summary) {
      markdown += `\n> ${domain}`;
    }

    return markdown;
  }

  function isPreviewCardAnchor(anchor) {
    if (!(anchor instanceof Element)) return false;
    if (anchor.closest('[data-testid="tweetText"]')) return false;
    if (anchor.closest('[data-testid="User-Name"]')) return false;
    if (anchor.closest('[role="group"][id]')) return false;
    if (anchor.querySelector('time')) return false;

    const rawHref = anchor.getAttribute('href') || anchor.href || '';
    const url = normalizeAnchorUrl(rawHref);
    if (!url || !looksLikeCardDestination(url, rawHref)) return false;

    const texts = collectPreviewCardTexts(anchor);
    const hasMedia = Boolean(anchor.querySelector('img, video'));
    const hasCardMarker =
      anchor.matches('[data-testid*="card"]') ||
      Boolean(anchor.querySelector('[data-testid*="card"]'));
    const hasEnoughText = texts.join(' ').length >= 18;

    return hasCardMarker || hasMedia || texts.length >= 2 || hasEnoughText;
  }

  function looksLikeCardDestination(url, rawHref) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();

      if (hostname === 't.co') return true;
      if (hostname === 'x.com' || hostname === 'twitter.com') {
        return !/^\/(home|explore|search|messages|notifications|i\/|compose)/i.test(rawHref || '') &&
          !/\/status\/\d+/i.test(parsed.pathname);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeAnchorUrl(href) {
    if (!href) return '';

    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    if (href.startsWith('//')) {
      return `https:${href}`;
    }

    if (href.startsWith('/')) {
      return `https://x.com${href}`;
    }

    return '';
  }

  function collectPreviewCardTexts(anchor) {
    const texts = [];
    const nodes = anchor.querySelectorAll('span, div');

    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (node.querySelector('img, video, svg')) continue;

      const text = sanitizeCardText(node.textContent);
      if (!text || text.length > 220 || isNoiseCardText(text)) continue;
      if (
        texts.some((existing) => existing === text || existing.includes(text) || text.includes(existing))
      ) {
        continue;
      }

      texts.push(text);
    }

    if (!texts.length) {
      const fallback = sanitizeCardText(anchor.textContent);
      if (fallback && !isNoiseCardText(fallback)) {
        texts.push(fallback);
      }
    }

    return texts;
  }

  function sanitizeCardText(text) {
    return (text || '')
      .replace(/\s+/g, ' ')
      .replace(/\u200b/g, '')
      .trim();
  }

  function isNoiseCardText(text) {
    if (!text) return true;
    if (/^(open|view|show more)$/i.test(text)) return true;
    if (/^[\d\s.,/:_-]+$/.test(text)) return true;
    return false;
  }

  function deriveCardDomain(url, texts) {
    const explicitDomain = (texts || []).find((text) => isLikelyDomainText(text));
    if (explicitDomain) return explicitDomain.toLowerCase();

    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function isLikelyDomainText(text) {
    return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]+)?$/i.test((text || '').trim());
  }

  function escapeMarkdownLinkLabel(text) {
    return (text || 'Link')
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\r?\n/g, ' ');
  }

  function walkTextNode(el) {
    if (!el) return '';

    let text = '';

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      if (tag === 'br') {
        text += '\n';
        return;
      }

      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        const linkText = node.textContent.trim();
        if (href.startsWith('http')) text += `[${linkText}](${href})`;
        else if (href.startsWith('/')) text += `[${linkText}](https://x.com${href})`;
        else text += linkText;
        return;
      }

      if (tag === 'img') {
        const alt = node.getAttribute('alt');
        if (alt && !alt.includes('Image')) text += alt;
        return;
      }

      node.childNodes.forEach(walk);
    };

    el.childNodes.forEach(walk);
    return text.trim();
  }

  function upgradeImageUrl(src) {
    if (src.includes('pbs.twimg.com/media')) {
      src = src.replace(/&name=\w+/, '&name=large');
      if (!src.includes('name=')) {
        src += (src.includes('?') ? '&' : '?') + 'name=large';
      }
    }
    return src;
  }

  function getMainTweet() {
    const statusMatch = window.location.href.match(/\/status\/(\d+)/);
    if (!statusMatch) return null;

    const statusId = statusMatch[1];
    const articles = document.querySelectorAll('article[data-testid="tweet"]');

    for (const article of articles) {
      const links = article.querySelectorAll(`a[href*="/status/${statusId}"]`);
      for (const link of links) {
        if (link.querySelector('time')) return article;
      }
    }

    for (const article of articles) {
      if (article.querySelector('[data-testid="tweetText"]')) return article;
    }

    return articles[0] || null;
  }

  function extractAuthorInfo(tweetEl) {
    const el = tweetEl.querySelector('[data-testid="User-Name"]');
    if (!el) return { displayName: 'Unknown', handle: '@unknown' };

    let handle = '';
    let displayName = '';

    const links = el.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('/') && !href.includes('/status/')) {
        handle = '@' + href.slice(1);
        break;
      }
    }

    const firstLink = el.querySelector('a');
    if (firstLink) {
      const clone = firstLink.cloneNode(true);
      clone.querySelectorAll('svg').forEach((svg) => svg.remove());
      displayName = clone.textContent.trim();
    }

    return {
      displayName: displayName || 'Unknown',
      handle: handle || '@unknown',
    };
  }

  function extractTime(tweetEl) {
    const timeEl = tweetEl.querySelector('time[datetime]');
    if (!timeEl) return null;

    const datetime = timeEl.getAttribute('datetime');
    if (!datetime) return timeEl.textContent.trim();

    const date = new Date(datetime);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function extractStats(tweetEl) {
    const stats = { replies: '0', retweets: '0', likes: '0' };
    const actionGroup = tweetEl.querySelector('[role="group"][id]');
    if (!actionGroup) return stats;

    const buttons = actionGroup.querySelectorAll('[role="button"]');
    const labels = ['replies', 'retweets', 'likes'];

    buttons.forEach((btn, idx) => {
      if (idx >= labels.length) return;

      const ariaLabel = btn.getAttribute('aria-label') || '';
      const matchedNumber = ariaLabel.match(/[\d,.]+[KkMm]?/);
      if (matchedNumber) {
        stats[labels[idx]] = matchedNumber[0];
        return;
      }

      const span = btn.querySelector('span span');
      if (span && span.textContent.trim()) {
        stats[labels[idx]] = span.textContent.trim();
      }
    });

    return stats;
  }

  function extractThreadTweets(mainTweetEl) {
    const author = extractAuthorInfo(mainTweetEl);
    const allArticles = document.querySelectorAll('article[data-testid="tweet"]');
    const mainIdx = Array.from(allArticles).indexOf(mainTweetEl);
    const tweets = [];

    for (let i = mainIdx + 1; i < allArticles.length; i += 1) {
      const article = allArticles[i];
      if (extractAuthorInfo(article).handle === author.handle) {
        tweets.push(extractRichContent(article));
      } else {
        break;
      }
    }

    return tweets;
  }

  function extractComments() {
    const mainTweetEl = getMainTweet();
    if (!mainTweetEl) return [];

    const author = extractAuthorInfo(mainTweetEl);
    const allArticles = document.querySelectorAll('article[data-testid="tweet"]');
    const mainIdx = Array.from(allArticles).indexOf(mainTweetEl);
    const comments = [];
    let pastThread = false;

    for (let i = mainIdx + 1; i < allArticles.length; i += 1) {
      const article = allArticles[i];
      const commentAuthor = extractAuthorInfo(article);

      if (!pastThread && commentAuthor.handle === author.handle) continue;
      pastThread = true;

      const textData = extractRichContent(article);
      const text = textData.t.replace(/!\[[^\]]*\]\(__IMG_\d+__\)/g, '').trim();
      if (text) {
        comments.push({
          author: commentAuthor,
          text,
          time: extractTime(article),
        });
      }

      if (comments.length >= 20) break;
    }

    return comments;
  }

  function buildMetadata(author, time, stats, options) {
    let md = '';

    if (options.includeAuthor) {
      md += `**作者**: ${author.displayName} (${author.handle})\n\n`;
    }
    if (options.includeTime && time) {
      md += `**时间**: ${time}\n\n`;
    }
    if (options.includeStats) {
      md += `**互动**: ❤️ ${stats.likes} | 🔁 ${stats.retweets} | 💬 ${stats.replies}\n\n`;
    }
    if (md) {
      md += '---\n\n';
    }

    return md;
  }

  function buildComments(options) {
    if (!options.includeComments) return '';

    const comments = extractComments();
    if (!comments.length) return '';

    let md = '---\n\n## 评论\n\n';
    for (const comment of comments) {
      const timeText = comment.time ? ` _(${comment.time})_` : '';
      md += `> **${comment.author.displayName}** (${comment.author.handle})${timeText}\n>\n> ${comment.text.replace(/\n/g, '\n> ')}\n\n`;
    }

    return md;
  }

  function makeFilename(titleText, author) {
    const pad = (value) => String(value).padStart(2, '0');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    let snippet = stripMarkdownSyntax(stripImageMarkdown(titleText))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\.+$/g, '')
      .substring(0, 24)
      .trim();

    if (!snippet || looksLikeImageLabel(snippet)) {
      snippet = 'Post';
    }

    const handle = author && author.handle ? author.handle.replace('@', '') : 'user';
    return `X_${handle}_${dateStr}_${snippet}`;
  }

  function finalizeMarkdown(mdLayout, imagesArray, replacementFunc) {
    let finalMd = mdLayout;
    for (let i = 0; i < imagesArray.length; i += 1) {
      finalMd = finalMd.replace(`__IMG_${i}__`, replacementFunc(imagesArray[i], i));
    }
    return finalMd;
  }

  function downloadAsLink(titleText, textData, author, time, stats, threadTweets, options) {
    let md = `# ${titleText}\n\n`;
    md += buildMetadata(author, time, stats, options);
    md += finalizeMarkdown(textData.t, textData.imgs, (url) => url) + '\n\n';

    if (threadTweets.length) {
      md += '---\n\n';
      for (const tweet of threadTweets) {
        md += finalizeMarkdown(tweet.t, tweet.imgs, (url) => url) + '\n\n';
      }
    }

    md += buildComments(options);
    triggerDownloadFile(md, makeFilename(titleText, author) + '.md');
  }

  async function downloadAsEmbed(titleText, textData, author, time, stats, threadTweets, options) {
    let md = `# ${titleText}\n\n`;
    md += buildMetadata(author, time, stats, options);

    const allImages = [...textData.imgs];
    for (const tweet of threadTweets) allImages.push(...tweet.imgs);

    const processedImages = {};
    let imgCount = 0;

    for (const url of allImages) {
      if (processedImages[url]) continue;

      imgCount += 1;
      sendProgress(`正在压缩图片 ${imgCount}/${allImages.length}...`);

      try {
        const { base64, contentType } = await fetchImageViaBackground(url);
        processedImages[url] = await compressImage(base64, contentType);
      } catch (error) {
        processedImages[url] = url;
      }
    }

    md += finalizeMarkdown(textData.t, textData.imgs, (url) => processedImages[url]) + '\n\n';

    if (threadTweets.length) {
      md += '---\n\n';
      for (const tweet of threadTweets) {
        md += finalizeMarkdown(tweet.t, tweet.imgs, (url) => processedImages[url]) + '\n\n';
      }
    }

    md += buildComments(options);
    sendProgress('正在保存文件...');
    triggerDownloadFile(md, makeFilename(titleText, author) + '.md');
  }

  async function downloadAsZip(titleText, textData, author, time, stats, threadTweets, options) {
    const zip = new JSZip();

    let md = `# ${titleText}\n\n`;
    md += buildMetadata(author, time, stats, options);

    const allImages = [...textData.imgs];
    for (const tweet of threadTweets) allImages.push(...tweet.imgs);

    const imageToLocalPath = {};
    const uniqueImages = [...new Set(allImages)];

    uniqueImages.forEach((url, index) => {
      imageToLocalPath[url] = `images/image_${index + 1}.jpg`;
    });

    md += finalizeMarkdown(textData.t, textData.imgs, (url) => imageToLocalPath[url]) + '\n\n';

    if (threadTweets.length) {
      md += '---\n\n';
      for (const tweet of threadTweets) {
        md += finalizeMarkdown(tweet.t, tweet.imgs, (url) => imageToLocalPath[url]) + '\n\n';
      }
    }

    md += buildComments(options);
    zip.file('post.md', md.replace(/\n{3,}/g, '\n\n'));

    for (let i = 0; i < uniqueImages.length; i += 1) {
      const url = uniqueImages[i];
      const localPath = imageToLocalPath[url];

      sendProgress(`正在下载图片 ${i + 1}/${uniqueImages.length}...`);
      try {
        const { base64, contentType } = await fetchImageViaBackground(url);
        const compressedDataUrl = await compressImage(base64, contentType);
        zip.file(localPath, compressedDataUrl.split(',')[1], { base64: true });
      } catch (error) {
        console.warn(`[XPD] Failed to download ${localPath}:`, error);
      }
    }

    sendProgress('正在打包 ZIP...');
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownloadBlob(blob, makeFilename(titleText, author) + '.zip');
  }

  function fetchImageViaBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.success) {
          reject(new Error(resp?.error || 'fetch failed'));
          return;
        }
        resolve(resp.data);
      });
    });
  }

  function compressImage(base64, contentType) {
    return new Promise((resolve) => {
      const dataUrl = `data:${contentType};base64,${base64}`;
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > MAX_IMAGE_WIDTH) {
            height = Math.round((height * MAX_IMAGE_WIDTH) / width);
            width = MAX_IMAGE_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch (error) {
          resolve(dataUrl);
        }
      };

      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function triggerDownloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    triggerDownloadBlob(blob, filename);
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  console.log('[XPD] X Markdown Exporter content script loaded');
})();
