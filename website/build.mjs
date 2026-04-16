import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const distRoot = path.join(websiteRoot, 'dist');
const stylesSourcePath = path.join(websiteRoot, 'src', 'styles.css');

const docs = [
  {
    slug: 'sqlfu',
    title: 'sqlfu',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'README.md'),
    description: 'Overview, quick start, CLI model, and core concepts.',
  },
  {
    slug: 'schema-diff-model',
    title: 'Schema Diff Model',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'schema-diff-model.md'),
    description: 'How sqlfu models SQLite schema diffing and migration planning.',
  },
  {
    slug: 'migration-model',
    title: 'Migration Model',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'migration-model.md'),
    description: 'Migration history, drift checks, and the intended production path.',
  },
  {
    slug: 'ui',
    title: 'UI',
    sourcePath: path.join(repoRoot, 'packages', 'ui', 'README.md'),
    description: 'The browser client and how it relates to the local backend server.',
  },
];

await fs.rm(distRoot, {recursive: true, force: true});
await fs.mkdir(path.join(distRoot, 'docs'), {recursive: true});
await fs.copyFile(stylesSourcePath, path.join(distRoot, 'styles.css'));

const renderedDocs = await Promise.all(docs.map(renderDoc));

await fs.writeFile(path.join(distRoot, 'index.html'), renderLandingPage(renderedDocs));
await fs.writeFile(path.join(distRoot, 'docs', 'index.html'), renderDocsIndexPage(renderedDocs));

for (const doc of renderedDocs) {
  const docDir = path.join(distRoot, 'docs', doc.slug);
  await fs.mkdir(docDir, {recursive: true});
  await fs.writeFile(path.join(docDir, 'index.html'), renderDocPage(doc, renderedDocs));
}

async function renderDoc(doc) {
  const markdown = await fs.readFile(doc.sourcePath, 'utf8');
  return {
    ...doc,
    markdown,
    html: renderMarkdown(markdown),
  };
}

function renderLandingPage(renderedDocs) {
  return renderPage({
    title: 'sqlfu',
    body: `
      <section class="hero">
        <article class="hero-main">
          <div class="eyebrow">sqlite-first tooling</div>
          <h1>sql that stays in charge.</h1>
          <p class="lede">
            sqlfu keeps schema, migrations, checked-in queries, type generation, diffing, and the browser studio aligned around real SQL files instead of another abstraction layer.
          </p>
          <div class="cta-row">
            <a class="button primary" href="/docs/sqlfu/">Read the docs</a>
            <a class="button" href="#local-studio">Use the local studio</a>
          </div>
        </article>
        <aside class="panel">
          <div class="eyebrow">local workflow</div>
          <p><code>npx sqlfu</code> starts the local backend on <code>localhost:3217</code>.</p>
          <p><code>local.sqlfu.dev</code> should resolve to that local server. The browser UI talks to the backend there; the heavy client bundle stays separate from the published runtime package.</p>
          <pre><code>npx sqlfu

# then open
http://local.sqlfu.dev</code></pre>
        </aside>
      </section>

      <h2 class="section-title">Core Surfaces</h2>
      <section class="section-grid">
        <article class="panel">
          <div class="eyebrow">docs</div>
          <p>Static documentation at <code>www.sqlfu.dev</code>, sourced from the repo markdown and rendered for the web without rewriting the content into a second format.</p>
        </article>
        <article class="panel">
          <div class="eyebrow">backend</div>
          <p>The UI-facing API lives in <code>packages/sqlfu</code>. That is the product backend end users run locally, not a sidecar hidden in the UI package.</p>
        </article>
        <article class="panel">
          <div class="eyebrow">client</div>
          <p><code>packages/ui</code> is a client-only app. React, CodeMirror, and the heavier browser dependencies stay there instead of inflating the runtime package.</p>
        </article>
      </section>

      <h2 class="section-title" id="local-studio">Local Studio</h2>
      <section class="hero">
        <article class="panel">
          <p>The local studio model is intentionally boring:</p>
          <ol>
            <li>run <code>npx sqlfu</code> inside your project</li>
            <li>the server resolves your local <code>sqlfu.config.ts</code></li>
            <li>open <code>local.sqlfu.dev</code></li>
            <li>the browser UI talks to your local backend over <code>/api/rpc</code></li>
          </ol>
        </article>
        <article class="panel">
          <div class="eyebrow">docs set</div>
          <p>${renderedDocs.map((doc) => `<a href="/docs/${doc.slug}/">${escapeHtml(doc.title)}</a>`).join('<br />')}</p>
        </article>
      </section>
    `,
  });
}

function renderDocsIndexPage(renderedDocs) {
  return renderPage({
    title: 'sqlfu docs',
    body: `
      <section class="docs-shell">
        <nav class="docs-nav">
          <h2>Docs</h2>
          ${renderedDocs.map((doc) => `<a href="/docs/${doc.slug}/">${escapeHtml(doc.title)}</a>`).join('\n')}
        </nav>
        <article class="doc-panel">
          <div class="doc-meta">Documentation index</div>
          <div class="doc-content">
            <h1>Repo markdown, web-shaped.</h1>
            <p>The first website cut keeps the existing markdown as the source of truth. These pages are rendered from the repo files rather than rewritten into a separate docs system.</p>
            <div class="section-grid">
              ${renderedDocs.map((doc) => `
                <section class="panel">
                  <div class="eyebrow">doc</div>
                  <h2>${escapeHtml(doc.title)}</h2>
                  <p>${escapeHtml(doc.description)}</p>
                  <p><a href="/docs/${doc.slug}/">Open page</a></p>
                </section>
              `).join('\n')}
            </div>
          </div>
        </article>
      </section>
    `,
  });
}

function renderDocPage(currentDoc, renderedDocs) {
  return renderPage({
    title: `${currentDoc.title} | sqlfu`,
    body: `
      <section class="docs-shell">
        <nav class="docs-nav">
          <h2>Docs</h2>
          ${renderedDocs.map((doc) => `<a class="${doc.slug === currentDoc.slug ? 'active' : ''}" href="/docs/${doc.slug}/">${escapeHtml(doc.title)}</a>`).join('\n')}
        </nav>
        <article class="doc-panel">
          <div class="doc-meta">Source: ${escapeHtml(path.relative(repoRoot, currentDoc.sourcePath))}</div>
          <div class="doc-content">
            ${currentDoc.html}
          </div>
        </article>
      </section>
    `,
  });
}

function renderPage({title, body}) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <link rel="stylesheet" href="/styles.css" />',
    '</head>',
    '<body>',
    '  <div class="site-shell">',
    '    <header class="topbar">',
    '      <a class="brand" href="/">sqlfu</a>',
    '      <nav class="nav">',
    '        <a href="/docs/index.html">Docs</a>',
    '        <a href="/docs/sqlfu/">Quick Start</a>',
    '        <a href="/">Local Studio</a>',
    '      </nav>',
    '    </header>',
         body,
    '    <footer class="footer">',
    '      Static docs site for sqlfu. Local studio backend lives at <code>local.sqlfu.dev</code> when <code>npx sqlfu</code> is running.',
    '    </footer>',
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;
  let inCodeBlock = false;
  let codeFence = '';
  let codeLines = [];
  let paragraphLines = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    html.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      return;
    }
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) {
      return;
    }
    html.push(`<blockquote>${renderInline(quoteLines.join(' '))}</blockquote>`);
    quoteLines = [];
  };

  while (index < lines.length) {
    const line = lines[index];

    if (inCodeBlock) {
      if (line.startsWith(codeFence)) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeFence = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      inCodeBlock = true;
      codeFence = fenceMatch[1];
      codeLines = [];
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugify(text);
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      const nextListType = /\d+\./.test(listMatch[2]) ? 'ol' : 'ul';
      if (listType && listType !== nextListType) {
        flushList();
      }
      listType = nextListType;
      listItems.push(listMatch[3]);
      index += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      flushList();
      quoteLines.push(line.slice(2));
      index += 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      index += 1;
      continue;
    }

    paragraphLines.push(line.trim());
    index += 1;
  }

  flushParagraph();
  flushList();
  flushQuote();

  return html.join('\n');
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${rewriteLink(href)}">${label}</a>`);
}

function rewriteLink(href) {
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
    return href;
  }
  if (href.endsWith('.md')) {
    const normalized = href
      .replace(/^\.\//, '')
      .replace(/^packages\/sqlfu\//, '')
      .replace(/^docs\//, '')
      .replace(/README\.md$/, 'sqlfu')
      .replace(/\.md$/, '')
      .replace(/^ui$/, 'ui');
    return `/docs/${normalized}/`;
  }
  return href;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
