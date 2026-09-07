// Shared project-local dependency reference extraction.
//
// Used by both MCP artifact bundling and public-file publishing so the two
// surfaces agree on which local files belong to an HTML/CSS/JS artifact.
//
// This intentionally returns project-relative logical paths only. External,
// data, fragment and project-root-escaping references are not returned.

// Patterns common to HTML and CSS.
const HTML_REF_PATTERNS = [
  /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
  /<img\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<source\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<video\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<audio\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi,
];

const CSS_REF_PATTERNS = [
  /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
  /@import\s+(?:url\()?\s*["']([^"')]+)["']/gi,
];

// JS/TS only - running these on prose creates false positives on words
// like "imported from 'X'".
const JS_REF_PATTERNS = [
  /\bimport\s+[^'"]*?['"]([^'"]+)['"]/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// `srcset` can list multiple comma-separated candidates.
const SRCSET_PATTERN = /\bsrcset=["']([^"']+)["']/gi;

// Public HTML snapshots may also represent a small multi-page site.
// Navigation links are deliberately kept separate from runtime dependencies:
// MCP artifact bundling must not start treating every <a href> as a dependency.
const HTML_NAV_REF_PATTERN = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;

function isJsLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /javascript|typescript/i.test(mime)) return true;
  return /\.(?:m?jsx?|tsx?|cjs)$/i.test(fromPath);
}

function isCssLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/css\b/i.test(mime)) return true;
  return /\.css$/i.test(fromPath);
}

function isHtmlLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/html\b/i.test(mime)) return true;
  return /\.html?$/i.test(fromPath);
}

function resolveProjectLocalRef(
  raw: string,
  fromPath: string,
  allowRootRelative: boolean,
): string | null {
  if (/^(?:https?:|\/\/|data:|mailto:|tel:|#)/i.test(raw)) return null;
  if (!allowRootRelative && raw.startsWith('/')) return null;

  const dir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1)
    : '';

  const resolved = raw.startsWith('/') ? raw.slice(1) : dir + raw;
  const stripped = resolved.replace(/[?#].*$/, '');
  const segments = stripped.split('/').filter(Boolean);

  const out: string[] = [];

  for (const segment of segments) {
    if (segment === '.') continue;

    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }

    out.push(segment);
  }

  return out.length > 0 ? out.join('/') : null;
}

export function referenceMimeForPath(filePath: string): string | null {
  if (/\.html?$/i.test(filePath)) return 'text/html';
  if (/\.css$/i.test(filePath)) return 'text/css';
  if (/\.tsx?$/i.test(filePath)) {
    return 'application/typescript';
  }
  if (/\.(?:m?jsx?|cjs)$/i.test(filePath)) return 'application/javascript';
  if (/\.svg$/i.test(filePath)) return 'image/svg+xml';
  return null;
}

export function extractRelativeRefs(
  text: string,
  fromPath: string,
  fromMime: string,
): string[] {
  if (!text) return [];

  const refs = new Set<string>();
  const runPatterns: RegExp[] = [];

  if (isHtmlLike(fromMime, fromPath)) {
    runPatterns.push(...HTML_REF_PATTERNS, ...CSS_REF_PATTERNS);
  }
  if (isCssLike(fromMime, fromPath)) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }
  if (isJsLike(fromMime, fromPath)) {
    runPatterns.push(...JS_REF_PATTERNS);
  }

  // Fallback for unknown textual files: only the safest pattern,
  // url() in case it's CSS-in-something we don't recognize.
  if (runPatterns.length === 0) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }

  const candidates: string[] = [];

  for (const re of runPatterns) {
    for (const match of text.matchAll(re)) {
      const ref = (match[1] || '').trim();
      if (ref) candidates.push(ref);
    }
  }

  if (isHtmlLike(fromMime, fromPath)) {
    for (const match of text.matchAll(SRCSET_PATTERN)) {
      const list = match[1] || '';
      for (const part of list.split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      }
    }
  }

  for (const raw of candidates) {
    const resolved = resolveProjectLocalRef(raw, fromPath, true);
    if (resolved) refs.add(resolved);
  }

  return [...refs];
}

/**
 * Extract project-local HTML navigation targets for public multi-page snapshots.
 *
 * This is intentionally separate from extractRelativeRefs(): an anchor is a
 * navigation edge, not a runtime dependency, and MCP artifact bundling should
 * keep its existing behavior.
 *
 * Only relative .html/.htm links are followed. Root-relative links would point
 * at the resource-hub origin rather than the snapshot root unless the HTML were
 * rewritten, so those are deliberately excluded here.
 */
export function extractHtmlNavigationRefs(
  text: string,
  fromPath: string,
  fromMime: string,
): string[] {
  if (!text || !isHtmlLike(fromMime, fromPath)) return [];

  const refs = new Set<string>();

  for (const match of text.matchAll(HTML_NAV_REF_PATTERN)) {
    const raw = (match[1] || '').trim();
    if (!raw) continue;

    // Navigation schemes, protocol-relative URLs, fragments and root-relative
    // URLs are not files belonging to this snapshot.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) continue;

    const withoutQueryOrFragment = raw.replace(/[?#].*$/, '');
    if (!/\.html?$/i.test(withoutQueryOrFragment)) continue;

    const resolved = resolveProjectLocalRef(raw, fromPath, false);
    if (resolved) refs.add(resolved);
  }

  return [...refs];
}
