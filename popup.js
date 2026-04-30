const statusEl = document.getElementById('status');
const statusKindEl = document.getElementById('statusKind');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progressText');
const resultEl = document.getElementById('result');
const modeDescEl = document.getElementById('modeDesc');
const refreshBtn = document.getElementById('refreshBtn');

let currentTabId = null;
let currentMode = 'embed';

const MODE_DESCS = {
  link: '图片会保留原始链接，生成的 Markdown 最轻量。',
  embed: '图片压缩后以内嵌方式写入 Markdown，单文件保存更省心。',
  zip: 'Markdown 和图片一起打包成 ZIP，适合完整离线归档。',
};

function setStatus(type, text, kindLabel = '其他') {
  statusEl.className = `status ${type}`;
  statusEl.querySelector('span').textContent = text;
  statusKindEl.textContent = kindLabel;
}

function setActionDisabled(disabled) {
  downloadBtn.disabled = disabled;
  copyBtn.disabled = disabled;
}

function showResult(type, text) {
  resultEl.className = `result ${type}`;
  resultEl.textContent = text;
  resultEl.style.display = 'block';
  setTimeout(() => {
    resultEl.style.display = 'none';
  }, 4000);
}

function updateModeUi(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  modeDescEl.textContent = MODE_DESCS[mode];
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateModeUi(btn.dataset.mode);
    // Fix #13: use chrome.storage.local instead of localStorage
    chrome.storage.local.set({ xpd_mode: currentMode });
  });
});

// Fix #13: load mode from chrome.storage.local
chrome.storage.local.get('xpd_mode', (result) => {
  const savedMode = result?.xpd_mode;
  if (savedMode && MODE_DESCS[savedMode]) {
    updateModeUi(savedMode);
  } else {
    updateModeUi(currentMode);
  }
});

async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      setStatus('no', '无法获取当前标签页');
      return;
    }

    currentTabId = tab.id;
    const url = tab.url || '';

    if (!url.match(/^https:\/\/(x\.com|twitter\.com)\//)) {
      setStatus('no', '请打开 X 推文详情页或 Note 页面');
      setActionDisabled(true);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' });
      if (response && response.ok) {
        setStatus('ok', '可以下载当前内容', response.kindLabel);
        setActionDisabled(false);
      } else {
        setStatus(
          response?.loading ? 'loading' : 'no',
          response?.message || '页面还没准备好，请刷新后重试',
          response?.kindLabel
        );
        setActionDisabled(true);
      }
    } catch {
      setStatus('no', '页面还没准备好，请刷新后重试');
      setActionDisabled(true);
    }
  } catch {
    setStatus('no', '检测失败，请重试');
    setActionDisabled(true);
  }
}

checkCurrentPage();

refreshBtn.addEventListener('click', () => {
  if (currentTabId) {
    chrome.tabs.reload(currentTabId);
  } else {
    chrome.tabs.reload();
  }
  setTimeout(() => window.close(), 100);
});

downloadBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  setActionDisabled(true);
  downloadBtn.textContent = '处理中...';
  progressEl.classList.add('show');
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  try {
    progressText.textContent = '正在提取内容...';

    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'EXTRACT_AND_DOWNLOAD',
      mode: currentMode,
      options: {
        includeAuthor: true,
        includeTime: true,
        includeStats: false,
        includeComments: false,
      },
    });

    if (response && response.success) {
      showResult('success', '下载成功');
    } else {
      showResult('error', response?.error || '下载失败');
    }
  } catch {
    // Fix #12: friendly error message instead of raw error.message
    showResult('error', '下载失败，请刷新页面后重试');
  } finally {
    setActionDisabled(false);
    downloadBtn.textContent = '下载';
    progressEl.classList.remove('show');
  }
});

copyBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  setActionDisabled(true);
  copyBtn.textContent = '复制中...';
  progressEl.classList.add('show');
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  try {
    progressText.textContent = '正在复制 Markdown...';

    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'EXTRACT_AND_COPY',
      options: {
        includeAuthor: true,
        includeTime: true,
        includeStats: false,
        includeComments: false,
      },
    });

    if (response && response.success) {
      showResult('success', '已复制 Markdown');
    } else {
      showResult('error', response?.error || '复制失败');
    }
  } catch {
    showResult('error', '复制失败，请刷新页面后重试');
  } finally {
    setActionDisabled(false);
    copyBtn.textContent = '复制';
    progressEl.classList.remove('show');
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'XPD_PROGRESS') {
    progressText.textContent = msg.text;
  }
});
