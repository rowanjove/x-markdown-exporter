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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'EXTRACT_AND_DOWNLOAD') {
      handleExtractAndDownload(message.options, message.mode)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error('[XPD] Error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    return false;
  });

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
    let imgIndex = imageOffset;

    const elements = container.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, li, blockquote, ' +
      '[data-testid="tweetText"], ' +
      '[data-testid="tweetPhoto"] img, ' +
      'img[src*="pbs.twimg.com/media"], ' +
      'div[lang], ' +
      'div[data-block="true"]'
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
