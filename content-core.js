// X Markdown Exporter - Core Module
// Utilities, escaping helpers, and DOM extraction logic.

(function () {
  'use strict';

  const _XPD = (window._XPD = window._XPD || {});

  // ── Constants ──────────────────────────────────────────────────────

  const MAX_IMAGE_WIDTH = 1200;
  const JPEG_QUALITY = 0.7;
  const POST_DETAIL_URL_RE =
    /^https:\/\/(x\.com|twitter\.com)\/[^/]+\/(status|i\/web\/status)\/\d+/i;
  const ARTICLE_CONTENT_SELECTOR =
    '[data-testid="article-content"], ' +
    '[data-testid="noteContent"], ' +
    '[data-testid="richTextContainer"]';

  // ── Escaping helpers ───────────────────────────────────────────────

  function escapeHtml(text) {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeMarkdownText(text) {
    return (text || '')
      .replace(/\\/g, '\\\\')
      .replace(/([*_`~\[\]<>])/g, '\\$1');
  }

  function escapeMarkdownLinkLabel(text) {
    return (text || 'Link')
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\r?\n/g, ' ');
  }

  // ── Text stripping ────────────────────────────────────────────────

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
    const title =
      lines[0] || stripMarkdownSyntax(imageFreeText) || fallbackTitle || 'Post';
    return title.substring(0, 100).trim();
  }

  // ── URL helpers ────────────────────────────────────────────────────

  function upgradeImageUrl(src) {
    if (src.includes('pbs.twimg.com/media')) {
      src = src.replace(/&name=\w+/, '&name=large');
      if (!src.includes('name=')) {
        src += (src.includes('?') ? '&' : '?') + 'name=large';
      }
    }
    return src;
  }

  function normalizeAnchorUrl(href) {
    if (!href) return '';
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('//')) return `https:${href}`;
    if (href.startsWith('/')) return `https://x.com${href}`;
    return '';
  }

  function getArticleContainers(root = document) {
    return root.querySelectorAll(ARTICLE_CONTENT_SELECTOR);
  }

  function getTopLevelTweetArticles(root = document) {
    return Array.from(root.querySelectorAll('article[data-testid="tweet"]')).filter(
      (article) => !article.parentElement?.closest('article[data-testid="tweet"]')
    );
  }

  function isTweetMediaImage(src) {
    return Boolean(src && src.includes('pbs.twimg.com/media'));
  }

  function appendImagePlaceholder(src, imageState) {
    if (!imageState || !isTweetMediaImage(src)) return '';

    let nextSrc = src;
    if (
      nextSrc.includes('profile_images') ||
      nextSrc.includes('emoji') ||
      nextSrc.includes('icon')
    ) {
      return '';
    }

    nextSrc = upgradeImageUrl(nextSrc);
    if (imageState.imageSet.has(nextSrc)) return '';

    imageState.imageSet.add(nextSrc);
    imageState.images.push(nextSrc);

    const placeholder = `\n\n![图片${imageState.imgIndex + 1}](__IMG_${imageState.imgIndex}__)\n\n`;
    imageState.imgIndex += 1;
    return placeholder;
  }

  function prefixMarkdownLines(text, prefix) {
    return (text || '')
      .split('\n')
      .map((line) => `${prefix}${line}`)
      .join('\n');
  }

  // ── Link card helpers ──────────────────────────────────────────────

  function sanitizeCardText(text) {
    return (text || '').replace(/\s+/g, ' ').replace(/\u200b/g, '').trim();
  }

  function isNoiseCardText(text) {
    if (!text) return true;
    if (/^(open|view|show more)$/i.test(text)) return true;
    if (/^[\d\s.,/:_-]+$/.test(text)) return true;
    return false;
  }

  function isLikelyDomainText(text) {
    return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]+)?$/i.test((text || '').trim());
  }

  function deriveCardDomain(url, texts) {
    const explicitDomain = (texts || []).find((t) => isLikelyDomainText(t));
    if (explicitDomain) return explicitDomain.toLowerCase();
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function looksLikeCardDestination(url, rawHref) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (hostname === 't.co') return true;
      if (hostname === 'x.com' || hostname === 'twitter.com') {
        return (
          !/^\/(home|explore|search|messages|notifications|i\/|compose)/i.test(rawHref || '') &&
          !/\/status\/\d+/i.test(parsed.pathname)
        );
      }
      return true;
    } catch {
      return false;
    }
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
        texts.some(
          (existing) => existing === text || existing.includes(text) || text.includes(existing)
        )
      ) {
        continue;
      }
      texts.push(text);
    }
    if (!texts.length) {
      const fallback = sanitizeCardText(anchor.textContent);
      if (fallback && !isNoiseCardText(fallback)) texts.push(fallback);
    }
    return texts;
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

  function buildPreviewCardMarkdown(anchor, seenCardLinks) {
    if (!isPreviewCardAnchor(anchor)) return '';
    const url = normalizeAnchorUrl(anchor.getAttribute('href') || anchor.href || '');
    if (!url || seenCardLinks.has(url)) return '';
    seenCardLinks.add(url);

    const texts = collectPreviewCardTexts(anchor);
    const domain = deriveCardDomain(url, texts);
    const title = sanitizeCardText(
      texts.find((t) => !isLikelyDomainText(t) && t.length >= 4) || domain || url
    );
    const summary = sanitizeCardText(
      texts.find((t) => t !== title && !isLikelyDomainText(t))
    );

    let markdown = `[${escapeMarkdownLinkLabel(title)}](<${url}>)`;
    if (summary) markdown += `\n> ${summary}`;
    if (domain && domain !== title && domain !== summary) markdown += `\n> ${domain}`;
    return markdown;
  }

  // ── DOM text walking ───────────────────────────────────────────────

  function walkTextNode(el, imageState) {
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
        const linkText = escapeMarkdownLinkLabel(node.textContent.trim());
        if (href.startsWith('http')) {
          text += `[${linkText}](<${href}>)`;
        } else if (href.startsWith('/')) {
          text += `[${linkText}](<https://x.com${href}>)`;
        } else {
          text += node.textContent.trim();
        }
        return;
      }
      if (tag === 'img') {
        const mediaPlaceholder = appendImagePlaceholder(node.getAttribute('src') || node.src, imageState);
        if (mediaPlaceholder) {
          text += mediaPlaceholder;
          return;
        }
        const alt = node.getAttribute('alt');
        if (alt && !alt.includes('Image')) text += alt;
        return;
      }
      node.childNodes.forEach(walk);
    };

    el.childNodes.forEach(walk);
    return text.trim();
  }

  // ── Content extraction ─────────────────────────────────────────────

  /** Filter out elements that are nested inside other matched elements. O(n*d) */
  function filterTopLevelElements(elements) {
    const result = [];
    const seen = new Set();
    for (const el of elements) {
      let dominated = false;
      let parent = el.parentElement;
      while (parent) {
        if (seen.has(parent)) {
          dominated = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!dominated) {
        result.push(el);
        // Non-card anchors often wrap richer descendants such as quoted tweets.
        // Let those descendants survive the top-level filter so we do not drop
        // quoted text or images during export.
        if (el.tagName?.toLowerCase() !== 'a' || isPreviewCardAnchor(el)) {
          seen.add(el);
        }
      }
    }
    return result;
  }

  function buildQuotedTweetMarkdown(article, imageOffset) {
    if (!(article instanceof Element)) {
      return { markdown: '', imgs: [] };
    }

    const author = extractAuthorInfo(article);
    const time = extractTime(article);
    const quoteContent = extractRichContent(article, imageOffset, {
      includeQuotedTweets: false,
    });

    const metaParts = [`引用推文`];
    if (author.displayName || author.handle) {
      metaParts.push(`${author.displayName} (${author.handle})`);
    }
    if (time) metaParts.push(time);

    let markdown = `> ${metaParts.join(' · ')}\n>\n`;
    const quotedBody = quoteContent.t
      ? prefixMarkdownLines(quoteContent.t, '> ')
      : '> [无可提取正文]';
    markdown += `${quotedBody}\n\n`;

    return { markdown, imgs: quoteContent.imgs };
  }

  function extractRichContent(container, imageOffset = 0, options = {}) {
    const includeQuotedTweets = options.includeQuotedTweets !== false;
    let text = '';
    const images = [];
    const imageSet = new Set();
    const seenCardLinks = new Set();
    const imageState = {
      images,
      imageSet,
      imgIndex: imageOffset,
    };

    const rawElements = container.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, li, blockquote, ' +
        '[data-testid="tweetText"], ' +
        '[data-testid="tweetPhoto"] img, ' +
        'img[src*="pbs.twimg.com/media"], ' +
        'div[lang], ' +
        'div[data-block="true"], ' +
        (includeQuotedTweets ? 'article[data-testid="tweet"], ' : '') +
        'a[href]'
    );
    const elements = filterTopLevelElements(rawElements);

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();

      if (tag === 'a') {
        const cardMarkdown = buildPreviewCardMarkdown(el, seenCardLinks);
        if (cardMarkdown) text += `${cardMarkdown}\n\n`;
        continue;
      }

      if (tag === 'img') {
        const mediaPlaceholder = appendImagePlaceholder(el.src, imageState);
        if (mediaPlaceholder) text += mediaPlaceholder;
        continue;
      }

      if (tag === 'article' && el.getAttribute('data-testid') === 'tweet') {
        const quotedTweet = buildQuotedTweetMarkdown(el, imageState.imgIndex);
        if (quotedTweet.markdown) {
          text += quotedTweet.markdown;
          for (const img of quotedTweet.imgs) {
            if (!imageState.imageSet.has(img)) {
              imageState.imageSet.add(img);
              imageState.images.push(img);
            }
          }
          imageState.imgIndex = imageOffset + imageState.images.length;
        }
        continue;
      }

      const content = walkTextNode(el, imageState);
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

  function detectArticlePage() {
    const articleContainers = getArticleContainers();
    if (articleContainers.length > 0) return true;

    // On regular status detail pages, prefer the tweet extraction path unless
    // we have explicit long-form containers. This avoids misclassifying
    // quoted/complex tweets as Notes and dropping parts of the content.
    if (POST_DETAIL_URL_RE.test(window.location.href)) return false;

    const mainContent = document.querySelector('main[role="main"]');
    if (!mainContent) return false;

    const articles = getTopLevelTweetArticles(mainContent);
    if (articles.length === 0) return false;

    const firstArticle = articles[0];
    if (firstArticle.querySelectorAll('[data-testid="tweetText"]').length > 2) return true;

    const mainTimeline =
      mainContent.querySelector('[data-testid="primaryColumn"]') || mainContent;
    const richTextSections = mainTimeline.querySelectorAll(
      'div[lang] > span, div[data-block="true"], div[class*="DraftEditor"], div[class*="public-DraftEditor"]'
    );
    return richTextSections.length > 3;
  }

  function getMainTweet() {
    const statusMatch = window.location.href.match(/\/status\/(\d+)/);
    if (!statusMatch) return null;
    const statusId = statusMatch[1];
    const articles = getTopLevelTweetArticles();

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
    const pad = (v) => String(v).padStart(2, '0');
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
    const allArticles = getTopLevelTweetArticles();
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

  function extractArticle() {
    _XPD.sendProgress?.('正在提取长文内容...');
    let text = '';
    let images = [];
    let author = { displayName: 'Unknown', handle: '@unknown' };
    let time = null;

    const firstArticle = getTopLevelTweetArticles()[0];
    if (firstArticle) {
      author = extractAuthorInfo(firstArticle);
      time = extractTime(firstArticle);
    }

    const knownContainers = getArticleContainers();
    if (knownContainers.length > 0) {
      for (const container of knownContainers) {
        const { t, imgs } = extractRichContent(container, images.length);
        text += t + '\n\n';
        images.push(...imgs);
      }
    }
    if (!text.trim()) {
      console.log('[XPD] Trying broad content extraction...');
      const primaryColumn =
        document.querySelector('[data-testid="primaryColumn"]') || document.body;
      const { t, imgs } = extractRichContent(primaryColumn, images.length);
      text = t;
      images = imgs;
    }
    return { text: text.trim(), images, author, time };
  }

  function extractComments() {
    const mainTweetEl = getMainTweet();
    if (!mainTweetEl) return [];
    const author = extractAuthorInfo(mainTweetEl);
    const allArticles = getTopLevelTweetArticles();
    const mainIdx = Array.from(allArticles).indexOf(mainTweetEl);
    const comments = [];
    let pastThread = false;

    for (let i = mainIdx + 1; i < allArticles.length; i += 1) {
      const article = allArticles[i];
      const commentAuthor = extractAuthorInfo(article);
      if (!pastThread && commentAuthor.handle === author.handle) continue;
      pastThread = true;
      const textData = extractRichContent(article);
      const bodyText = textData.t.replace(/!\[[^\]]*\]\(__IMG_\d+__\)/g, '').trim();
      if (bodyText) {
        comments.push({ author: commentAuthor, text: bodyText, time: extractTime(article) });
      }
      if (comments.length >= 20) break;
    }
    return comments;
  }

  function makeFilename(titleText, author, isArticle) {
    const pad = (v) => String(v).padStart(2, '0');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    if (isArticle) {
      // 文章：直接用标题（纯文字，去图片）
      let title = stripMarkdownSyntax(stripImageMarkdown(titleText))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\.+$/g, '')
        .substring(0, 80)
        .trim();
      if (!title || looksLikeImageLabel(title)) title = `文章_${dateStr}`;
      return title;
    }

    // 普通推文：推文 + 时间
    return `推文_${dateStr}`;
  }

  // ── Export module ──────────────────────────────────────────────────

  _XPD.core = {
    MAX_IMAGE_WIDTH,
    JPEG_QUALITY,
    POST_DETAIL_URL_RE,
    escapeHtml,
    escapeMarkdownText,
    escapeMarkdownLinkLabel,
    stripImageMarkdown,
    stripMarkdownSyntax,
    looksLikeImageLabel,
    deriveTitleText,
    upgradeImageUrl,
    normalizeAnchorUrl,
    detectArticlePage,
    getMainTweet,
    extractArticle,
    extractRichContent,
    extractAuthorInfo,
    extractTime,
    extractStats,
    extractThreadTweets,
    extractComments,
    makeFilename,
  };
})();
