import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createMarkdown } from '../src/renderer/lib/markdown.ts';

const { window } = new JSDOM('');
const md = createMarkdown(window as unknown as Parameters<typeof createMarkdown>[0]);
const dom = (html: string) => {
  const container = window.document.createElement('div');
  container.innerHTML = html;
  return container;
};

test('script tags never survive, from Markdown or from raw HTML', () => {
  const fromMarkdown = md.render('Hello\n\n<script>alert(1)</script>\n\nworld');
  assert.equal(dom(fromMarkdown).querySelector('script'), null);
  assert.ok(fromMarkdown.includes('&lt;script&gt;'), 'raw HTML is shown as text');
  assert.equal(dom(md.sanitize('<p>x</p><script>alert(1)</script>')).querySelector('script'), null);
});

test('javascript: and other non-web links lose their href', () => {
  for (const source of ['[click](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,<b>hi</b>)', '[x](file:///etc/passwd)', '[x](vbscript:msgbox)']) {
    const link = dom(md.render(source)).querySelector('a');
    assert.ok(!link?.getAttribute('href'), source);
  }
  assert.equal(dom(md.sanitize('<a href="javascript:alert(1)">x</a>')).querySelector('a')?.getAttribute('href'), null);
});

test('event handler attributes are stripped', () => {
  const html = md.sanitize('<img src="data:image/png;base64,AAAA" onerror="alert(1)"><p onclick="alert(2)" onmouseover="x()">t</p><a href="https://a.test" onfocus="y()">a</a>');
  assert.ok(!/\son\w+=/i.test(html), html);
  assert.equal(dom(md.render('<img src=x onerror=alert(1)>')).querySelector('img'), null, 'raw <img> in Markdown stays text');
});

test('remote images are never loaded: Markdown images become links and stray <img> tags lose their src', () => {
  const rendered = dom(md.render('![a tracking pixel](https://tracker.example/p.gif)'));
  assert.equal(rendered.querySelector('img'), null);
  const link = rendered.querySelector('a.md-remote-image');
  assert.equal(link?.getAttribute('href'), 'https://tracker.example/p.gif');
  assert.match(link?.textContent ?? '', /tracking pixel/);

  const stray = dom(md.sanitize('<img src="https://tracker.example/p.gif" srcset="https://t.example/2x.gif 2x">')).querySelector('img');
  assert.equal(stray?.getAttribute('src') ?? null, null);
  assert.equal(stray?.getAttribute('srcset') ?? null, null);
});

test('inline data images still render', () => {
  const img = dom(md.render('![dot](data:image/png;base64,iVBORw0KGgo=)')).querySelector('img');
  assert.equal(img?.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
});

test('web links open outside the app and relative links resolve against the saved page', () => {
  const link = dom(md.render('[docs](/guide/start)', { baseUrl: 'https://example.com/blog/post' })).querySelector('a');
  assert.equal(link?.getAttribute('href'), 'https://example.com/guide/start');
  assert.equal(link?.getAttribute('target'), '_blank');
  assert.equal(link?.getAttribute('rel'), 'noreferrer noopener');
});

test('dangerous containers and inline styles are removed', () => {
  const html = md.sanitize('<iframe src="https://evil.test"></iframe><form action="https://evil.test"><input></form><p style="background:url(https://t.test/x)">ok</p><svg><script>1</script></svg>');
  const el = dom(html);
  for (const tag of ['iframe', 'form', 'input', 'svg', 'script']) assert.equal(el.querySelector(tag), null, tag);
  assert.equal(el.querySelector('p')?.getAttribute('style'), null);
});

test('ordinary Markdown still renders', () => {
  const el = dom(md.render('# Title\n\n- one\n- **two**\n\n`code` and [link](https://example.com)'));
  assert.equal(el.querySelector('h1')?.textContent, 'Title');
  assert.equal(el.querySelectorAll('li').length, 2);
  assert.equal(el.querySelector('strong')?.textContent, 'two');
  assert.equal(el.querySelector('a')?.getAttribute('href'), 'https://example.com');
});
