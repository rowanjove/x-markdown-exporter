# Changelog

## v1.6.0

### 中文

- 新增一键复制 Markdown 文本，方便把推文、线程和 Note 直接投喂给 OpenClaw、Claude Code 等本地或代理式 AI 工具。
- 在可下载状态旁新增内容标签，可显示推文、文章、线程、图片数量、引用推文和外链卡片等信息。
- 针对时间线、搜索页、探索页、主页和未加载完成的详情页提供更明确的操作提示。
- 更新 README，强化插件定位：绕开网页反爬带来的复制/抓取摩擦，高效把高价值 X 内容转成 Markdown，用于 AI 上下文或本地归档。

### English

- Added one-click Markdown copying so posts, threads, and Notes can be fed directly into OpenClaw, Claude Code, and similar local or agentic AI tools.
- Added richer content labels next to the readiness state, including post, article, thread, image count, quoted post, and link-card hints.
- Added more actionable guidance for timeline, search, explore, profile, and still-loading detail pages.
- Updated the README to clarify the positioning: turn high-value X content into Markdown for AI context and local archiving without fighting web anti-scraping friction.

## v1.5.0

- Added explicit extraction validation so DOM breakages no longer silently export blank Markdown files.
- Added clearer failure messaging with recovery guidance and a GitHub issue link for tweet and Note exports.
- Added a `source_url` metadata line to exported Markdown across `link`, `embed`, and `zip` modes.
- Added a size guard for oversized `embed` exports with a user confirmation step and automatic ZIP fallback.
- Reused already-processed images when `embed` downgrades to ZIP so fallback exports stay fast and predictable.

## v1.4.1

- Fixed missing-content cases around quoted tweets, nested rich-text images, and some status-page misclassification paths.
- Improved ZIP export reliability so Markdown keeps valid image references even when a local image download fails.
- Added a `文章_YYYYMMDD_HHMMSS` filename fallback for untitled long-form exports.
- Updated the popup fallback flow so Note pages can be exported from the toolbar entry too.

## v1.4.0

- Added the draggable in-page floating launcher and compact export panel.
- Added remembered launcher position and improved in-page export workflow.
- Added supported external preview-card extraction.
