/**
 * Scanner unit tests — run with: pnpm -F @extension/content-script test
 * Uses happy-dom via vitest environment.
 * @vitest-environment happy-dom
 */
import {
  failsLinkDensityHeuristic,
  isMeaningfulText,
  isSemanticallyExcluded,
  scanRoot,
  serializeUnitHtml,
  shouldSkipAsTargetLanguage,
  stripDiscardPlaceholders,
} from './scanner.js';
import { afterEach, describe, expect, it } from 'vitest';

const mount = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isMeaningfulText', () => {
  it('rejects short and punctuation-only', () => {
    expect(isMeaningfulText('ab')).toBe(false);
    expect(isMeaningfulText('...')).toBe(false);
    expect(isMeaningfulText('1234')).toBe(false);
    expect(isMeaningfulText('Hello world')).toBe(true);
  });
});

describe('shouldSkipAsTargetLanguage', () => {
  it('skips heavy CJK when target is ZH', () => {
    expect(shouldSkipAsTargetLanguage('这是一段已经是中文的正文内容', 'ZH')).toBe(true);
    expect(shouldSkipAsTargetLanguage('This is clearly English body copy here', 'ZH')).toBe(false);
  });

  it('does not skip Latin-script text for Latin target languages', () => {
    expect(shouldSkipAsTargetLanguage('Bonjour, ceci est un paragraphe francais a traduire.', 'EN')).toBe(false);
  });
});

describe('isSemanticallyExcluded', () => {
  it('excludes nav, toolbar roles, and body-level header', () => {
    mount(`
      <nav id="n">Home</nav>
      <div id="tb" role="toolbar">Tools</div>
      <header id="site-header">Logo</header>
      <article>
        <header id="article-header">Title inside article</header>
        <p id="p">Body</p>
      </article>
    `);
    expect(isSemanticallyExcluded(document.getElementById('n')!)).toBe(true);
    expect(isSemanticallyExcluded(document.getElementById('tb')!)).toBe(true);
    expect(isSemanticallyExcluded(document.getElementById('site-header')!)).toBe(true);
    expect(isSemanticallyExcluded(document.getElementById('article-header')!)).toBe(false);
  });
});

describe('failsLinkDensityHeuristic', () => {
  it('flags menu-like link clusters', () => {
    mount(`
      <div id="menu"><a href="/a">Home</a> <a href="/b">About</a> <a href="/c">Contact</a></div>
      <p id="article">This is a longer news paragraph with only one <a href="/x">inline link</a> inside.</p>
    `);
    expect(failsLinkDensityHeuristic(document.getElementById('menu')!)).toBe(true);
    expect(failsLinkDensityHeuristic(document.getElementById('article')!)).toBe(false);
  });
});

describe('serializeUnitHtml', () => {
  it('keeps semantic inline tags and discards controls via placeholders', () => {
    mount(`
      <p id="p">Hello <strong>world</strong> <button>X</button> and <a href="/t?utm_source=x">link</a></p>
    `);
    const html = serializeUnitHtml(document.getElementById('p') as HTMLElement);
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<a href=');
    expect(html).toMatch(/⦃\d+⦄/);
    expect(stripDiscardPlaceholders(html)).not.toMatch(/⦃/);
    expect(html).not.toContain('<button');
  });
});

describe('scanRoot fixtures', () => {
  it('news article: paragraphs selected, nav and buttons not', () => {
    mount(`
      <nav><a href="/">Home</a><a href="/tech">Tech</a></nav>
      <header><a href="/">Site</a></header>
      <article>
        <h1>Big Story About Software</h1>
        <p>First paragraph of the news article with enough text to translate.</p>
        <p>Second paragraph continues the story with more meaningful content.</p>
        <div class="actions">
          <button>Share</button>
          <button>Save</button>
        </div>
      </article>
      <footer><a href="/privacy">Privacy</a></footer>
    `);
    const { units } = scanRoot(document.body, { targetLang: 'ZH', nextUnitIndex: 0 });
    const texts = units.map(u => u.el.textContent?.trim() ?? '');
    expect(texts.some(t => t.includes('Big Story'))).toBe(true);
    expect(texts.some(t => t.includes('First paragraph'))).toBe(true);
    expect(texts.some(t => t.includes('Share'))).toBe(false);
    expect(texts.some(t => t.includes('Home'))).toBe(false);
    expect(texts.some(t => t.includes('Privacy'))).toBe(false);
  });

  it('GitHub-like issue: body text in, toolbar out', () => {
    mount(`
      <div role="toolbar" aria-label="actions">
        <button>Edit</button>
        <button>Close issue</button>
      </div>
      <div class="markdown-body">
        <p>I found a bug when clicking the submit button on the settings page.</p>
        <pre><code>const x = 1;</code></pre>
        <p>Please take a look at the stack trace above for more detail.</p>
      </div>
      <div role="navigation" class="sidebar">
        <a href="/issues">Issues</a>
        <a href="/pulls">Pull requests</a>
      </div>
    `);
    const { units } = scanRoot(document.body, { targetLang: 'ZH', nextUnitIndex: 0 });
    const texts = units.map(u => u.el.textContent?.trim() ?? '');
    expect(texts.some(t => t.includes('I found a bug'))).toBe(true);
    expect(texts.some(t => t.includes('Please take a look'))).toBe(true);
    expect(texts.some(t => t.includes('Close issue'))).toBe(false);
    expect(texts.some(t => t.includes('Pull requests'))).toBe(false);
    // pre/code skipped
    expect(texts.some(t => t.includes('const x'))).toBe(false);
  });

  it('infinite-scroll list: cards with body paragraphs, not action rows', () => {
    mount(`
      <main>
        <article class="card">
          <h2>Post title number one is long enough</h2>
          <p>Summary text for the first card in an infinite scroll feed layout.</p>
          <div role="group">
            <button>Upvote</button>
            <button>Comment</button>
          </div>
        </article>
        <article class="card">
          <h2>Post title number two is also long enough</h2>
          <p>Summary text for the second card appearing after scroll load more.</p>
        </article>
      </main>
    `);
    const { units } = scanRoot(document.body, { targetLang: 'ZH', nextUnitIndex: 0 });
    const texts = units.map(u => u.el.textContent?.trim() ?? '');
    expect(texts.filter(t => t.includes('Post title')).length).toBeGreaterThanOrEqual(2);
    expect(texts.some(t => t.includes('Summary text for the first'))).toBe(true);
    expect(texts.some(t => t.includes('Upvote'))).toBe(false);
  });

  it('does not treat a toolbar div of buttons as one unit', () => {
    mount(`
      <div id="toolbar">
        <button>Bold</button>
        <button>Italic</button>
        <span>Tools</span>
      </div>
      <p>A real paragraph that should still be collected for translation work.</p>
    `);
    const { units } = scanRoot(document.body, { targetLang: 'ZH', nextUnitIndex: 0 });
    expect(units.every(u => u.el.id !== 'toolbar')).toBe(true);
    expect(units.some(u => (u.el.textContent ?? '').includes('real paragraph'))).toBe(true);
  });
});
