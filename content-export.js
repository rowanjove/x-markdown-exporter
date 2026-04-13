// X Markdown Exporter - Export Module
// Markdown assembly, image processing, and download logic.

(function () {
  'use strict';

  const _XPD = window._XPD;
  const core = _XPD.core;

  const EMBED_WARN_THRESHOLD_BYTES = 12 * 1024 * 1024;

  // Metadata & comments assembly

  function buildMetadata(author, time, stats, options) {
    let md = '';
    if (options.includeAuthor) {
      const name = core.escapeMarkdownText(author.displayName);
      const handle = core.escapeMarkdownText(author.handle);
      md += `**作者**: ${name} (${handle})\n\n`;
    }
    if (options.includeTime && time) {
      md += `**时间**: ${core.escapeMarkdownText(time)}\n\n`;
    }
    if (options.sourceUrl) {
      md += `**source_url**: <${String(options.sourceUrl).replace(/>/g, '%3E')}>\n\n`;
    }
    if (options.includeStats) {
      md += `**互动**: ❤️ ${stats.likes} | 🔁 ${stats.retweets} | 💬 ${stats.replies}\n\n`;
    }
    if (md) md += '---\n\n';
    return md;
  }

  function buildComments(options) {
    if (!options.includeComments) return '';
    const comments = core.extractComments();
    if (!comments.length) return '';

    let md = '---\n\n## 评论\n\n';
    for (const comment of comments) {
      const name = core.escapeMarkdownText(comment.author.displayName);
      const handle = core.escapeMarkdownText(comment.author.handle);
      const timeText = comment.time ? ` _(${core.escapeMarkdownText(comment.time)})_` : '';
      const body = comment.text.replace(/\n/g, '\n> ');
      md += `> **${name}** (${handle})${timeText}\n>\n> ${body}\n\n`;
    }
    return md;
  }

  // Markdown finalization

  function finalizeMarkdown(mdLayout, imagesArray, replacementFunc) {
    let finalMd = mdLayout;
    for (let i = 0; i < imagesArray.length; i += 1) {
      finalMd = finalMd.replace(`__IMG_${i}__`, replacementFunc(imagesArray[i], i));
    }
    return finalMd;
  }

  function buildThreadSection(threadTweets, replacementFunc) {
    if (!threadTweets.length) return '';

    let md = '---\n\n';
    for (const tweet of threadTweets) {
      md += finalizeMarkdown(tweet.t, tweet.imgs, replacementFunc) + '\n\n';
    }
    return md;
  }

  function composeMarkdown(titleText, textData, author, time, stats, threadTweets, options, replacementFunc) {
    let md = `# ${titleText}\n\n`;
    md += buildMetadata(author, time, stats, options);
    md += finalizeMarkdown(textData.t, textData.imgs, replacementFunc) + '\n\n';
    md += buildThreadSection(threadTweets, replacementFunc);
    md += buildComments(options);
    return md.replace(/\n{3,}/g, '\n\n');
  }

  // Image processing

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
          if (width > core.MAX_IMAGE_WIDTH) {
            height = Math.round((height * core.MAX_IMAGE_WIDTH) / width);
            width = core.MAX_IMAGE_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', core.JPEG_QUALITY));
        } catch (error) {
          console.warn('[XPD] Image compression failed, using original:', error.message);
          resolve(dataUrl);
        }
      };

      img.onerror = () => {
        console.warn('[XPD] Image load failed, using original data URL');
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  /** Determine file extension from content-type for ZIP packaging. */
  function getImageExtension(contentType) {
    if (!contentType) return '.jpg';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('webp')) return '.webp';
    return '.jpg';
  }

  function getDataUrlContentType(dataUrl) {
    const matched = /^data:([^;]+);base64,/i.exec(dataUrl || '');
    return matched?.[1]?.toLowerCase() || '';
  }

  function isDataUrl(value) {
    return /^data:[^;]+;base64,/i.test(value || '');
  }

  function collectAllImages(textData, threadTweets) {
    const allImages = [...textData.imgs];
    for (const tweet of threadTweets) allImages.push(...tweet.imgs);
    return allImages;
  }

  async function prepareProcessedImages(imageUrls, progressLabel) {
    const uniqueImages = [...new Set(imageUrls)];
    const processedImages = {};

    for (let i = 0; i < uniqueImages.length; i += 1) {
      const url = uniqueImages[i];
      _XPD.sendProgress?.(`${progressLabel} ${i + 1}/${uniqueImages.length}...`);
      try {
        const { base64, contentType } = await fetchImageViaBackground(url);
        processedImages[url] = await compressImage(base64, contentType);
      } catch (error) {
        console.warn('[XPD] Image fetch failed, using URL:', error.message);
        processedImages[url] = url;
      }
    }

    return { uniqueImages, processedImages };
  }

  function estimateMarkdownSize(markdown) {
    return new Blob([markdown], { type: 'text/plain;charset=utf-8' }).size;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function addDataUrlToZip(zip, dataUrl, index) {
    const outputContentType = getDataUrlContentType(dataUrl);
    const extension = getImageExtension(outputContentType);
    const localPath = `images/image_${index + 1}${extension}`;
    zip.file(localPath, dataUrl.split(',')[1], { base64: true });
    return localPath;
  }

  // Download modes

  function downloadAsLink(titleText, textData, author, time, stats, threadTweets, options) {
    const md = composeMarkdown(
      titleText,
      textData,
      author,
      time,
      stats,
      threadTweets,
      options,
      (url) => url
    );
    triggerDownloadFile(md, core.makeFilename(titleText, author, options.isArticle) + '.md');
  }

  async function downloadAsEmbed(titleText, textData, author, time, stats, threadTweets, options) {
    const allImages = collectAllImages(textData, threadTweets);
    const { processedImages } = await prepareProcessedImages(allImages, '正在压缩图片');

    const finalMd = composeMarkdown(
      titleText,
      textData,
      author,
      time,
      stats,
      threadTweets,
      options,
      (url) => processedImages[url] || url
    );
    const estimatedBytes = estimateMarkdownSize(finalMd);

    if (estimatedBytes > EMBED_WARN_THRESHOLD_BYTES) {
      const estimatedSize = formatBytes(estimatedBytes);
      _XPD.sendProgress?.('内嵌文件较大，等待确认...');
      const shouldContinueEmbed = window.confirm(
        `预计导出的 Markdown 约 ${estimatedSize}，继续使用 embed 模式可能导致编辑器卡顿。\n\n选择“确定”继续导出单文件；选择“取消”将自动改用 ZIP 打包。`
      );

      if (!shouldContinueEmbed) {
        _XPD.sendProgress?.('内嵌文件过大，正在切换到 ZIP 打包...');
        await downloadAsZip(
          titleText,
          textData,
          author,
          time,
          stats,
          threadTweets,
          options,
          processedImages
        );
        return;
      }
    }

    _XPD.sendProgress?.('正在保存文件...');
    triggerDownloadFile(finalMd, core.makeFilename(titleText, author, options.isArticle) + '.md');
  }

  async function downloadAsZip(
    titleText,
    textData,
    author,
    time,
    stats,
    threadTweets,
    options,
    preparedImages = null
  ) {
    const zip = new JSZip();
    const uniqueImages = [...new Set(collectAllImages(textData, threadTweets))];
    const imageTargets = {};

    for (let i = 0; i < uniqueImages.length; i += 1) {
      const url = uniqueImages[i];
      _XPD.sendProgress?.(`正在打包图片 ${i + 1}/${uniqueImages.length}...`);

      const preparedDataUrl = preparedImages?.[url];
      if (isDataUrl(preparedDataUrl)) {
        imageTargets[url] = addDataUrlToZip(zip, preparedDataUrl, i);
        continue;
      }

      try {
        const { base64, contentType } = await fetchImageViaBackground(url);
        const compressedDataUrl = await compressImage(base64, contentType);
        imageTargets[url] = addDataUrlToZip(zip, compressedDataUrl, i);
      } catch (error) {
        console.warn(`[XPD] Failed to download image ${i + 1}:`, error.message);
        // Keep the original remote URL in Markdown instead of pointing at
        // a missing local file.
        imageTargets[url] = url;
      }
    }

    const md = composeMarkdown(
      titleText,
      textData,
      author,
      time,
      stats,
      threadTweets,
      options,
      (url) => imageTargets[url] || url
    );
    zip.file('post.md', md);

    _XPD.sendProgress?.('正在打包 ZIP...');
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownloadBlob(blob, core.makeFilename(titleText, author, options.isArticle) + '.zip');
  }

  // File download triggers

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

  // Export module

  _XPD.exp = {
    buildMetadata,
    buildComments,
    finalizeMarkdown,
    downloadAsLink,
    downloadAsEmbed,
    downloadAsZip,
  };
})();
