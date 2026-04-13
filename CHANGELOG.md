# Changelog

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
