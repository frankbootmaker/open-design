import { describe, expect, it } from 'vitest';
import { extractHtmlNavigationRefs } from '../../src/artifacts/relative-refs.js';

describe('extractHtmlNavigationRefs', () => {
  it('resolves relative HTML navigation including fragments and query strings', () => {
    const refs = extractHtmlNavigationRefs(
      [
        '<a href="./about.html#team">About</a>',
        '<a href="contact.htm?from=home#form">Contact</a>',
      ].join(''),
      'pages/index.html',
      'text/html',
    );

    expect(refs).toEqual([
      'pages/about.html',
      'pages/contact.htm',
    ]);
  });

  it('resolves parent-relative HTML navigation inside the project', () => {
    const refs = extractHtmlNavigationRefs(
      '<a href="../about.html">About</a>',
      'pages/index.html',
      'text/html',
    );

    expect(refs).toEqual(['about.html']);
  });

  it('ignores external, scheme, fragment, root-relative and non-HTML links', () => {
    const refs = extractHtmlNavigationRefs(
      [
        '<a href="https://example.com/about.html">HTTPS</a>',
        '<a href="//example.com/about.html">Protocol relative</a>',
        '<a href="mailto:x@example.com">Mail</a>',
        '<a href="tel:+1">Tel</a>',
        '<a href="javascript:alert(1)">JS</a>',
        '<a href="ftp://example.com/about.html">FTP</a>',
        '<a href="#team">Fragment</a>',
        '<a href="/about.html">Root relative</a>',
        '<a href="guide.pdf">PDF</a>',
      ].join(''),
      'index.html',
      'text/html',
    );

    expect(refs).toEqual([]);
  });

  it('rejects navigation that escapes the project root', () => {
    const refs = extractHtmlNavigationRefs(
      '<a href="../../outside.html">Outside</a>',
      'pages/index.html',
      'text/html',
    );

    expect(refs).toEqual([]);
  });
});
