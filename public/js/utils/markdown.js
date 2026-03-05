/**
 * Lightweight markdown → HTML renderer.
 * XSS-safe: escapes all HTML entities first, then applies markdown transformations.
 * Supports: bold, italic, inline code, code blocks, headers, bullets, numbered lists, links, line breaks.
 */

import { escapeHtml } from './escapeHtml.js';

/**
 * Convert markdown text to safe HTML.
 * @param {string} text - Raw markdown text (may contain user content)
 * @returns {string} Safe HTML string
 */
export function renderMarkdown(text) {
  if (!text) return '';

  // Step 1: Escape all HTML to prevent XSS
  let html = escapeHtml(text);

  // Step 2: Extract and protect code blocks (``` ... ```)
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="chat-code-block"><code>${code.trim()}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // Step 3: Extract and protect inline code (` ... `)
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="chat-inline-code">${code}</code>`);
    return `%%INLINECODE_${idx}%%`;
  });

  // Step 4: Apply block-level formatting

  // Split into lines for block processing
  const lines = html.split('\n');
  const processed = [];
  let inList = false;
  let listType = null; // 'ul' or 'ol'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers (## Header)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      if (inList) { processed.push(`</${listType}>`); inList = false; listType = null; }
      const level = Math.min(headerMatch[1].length + 2, 6); // h3-h6
      processed.push(`<h${level} class="chat-heading">${headerMatch[2]}</h${level}>`);
      continue;
    }

    // Unordered list items (- item or * item)
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processed.push(`</${listType}>`);
        processed.push('<ul class="chat-list">');
        inList = true;
        listType = 'ul';
      }
      processed.push(`<li>${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list items (1. item)
    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processed.push(`</${listType}>`);
        processed.push('<ol class="chat-list">');
        inList = true;
        listType = 'ol';
      }
      processed.push(`<li>${applyInline(olMatch[1])}</li>`);
      continue;
    }

    // Close list if we're no longer in one
    if (inList) {
      processed.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    // Empty lines become paragraph breaks
    if (line.trim() === '') {
      processed.push('<br>');
      continue;
    }

    // Regular text
    processed.push(`<span>${applyInline(line)}</span>`);
  }

  // Close any open list
  if (inList) {
    processed.push(`</${listType}>`);
  }

  html = processed.join('\n');

  // Step 5: Restore code blocks and inline codes
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[parseInt(idx)]);
  html = html.replace(/%%INLINECODE_(\d+)%%/g, (_m, idx) => inlineCodes[parseInt(idx)]);

  return html;
}

/**
 * Apply inline markdown formatting (bold, italic, links).
 * Called on already-escaped text.
 */
function applyInline(text) {
  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not inside words for _)
  text = text.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  text = text.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');

  return text;
}
