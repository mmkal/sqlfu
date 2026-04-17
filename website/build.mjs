import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import MarkdownIt from 'markdown-it';

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const distRoot = path.join(websiteRoot, 'dist');
const stylesSourcePath = path.join(websiteRoot, 'src', 'styles.css');
const gitSha = readGit(['rev-parse', 'HEAD']);
const repositoryBaseUrl = normalizeRepositoryUrl(readGit(['remote', 'get-url', 'origin']));

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

const docBySourcePath = new Map(docs.map((doc) => [normalizePath(doc.sourcePath), doc]));
const docBySlug = new Map(docs.map((doc) => [doc.slug, doc]));

await fs.rm(distRoot, {recursive: true, force: true});
await fs.mkdir(path.join(distRoot, 'docs'), {recursive: true});
await fs.copyFile(stylesSourcePath, path.join(distRoot, 'styles.css'));

const renderedDocs = await Promise.all(docs.map(renderDoc));
const assetPaths = [...new Set(renderedDocs.flatMap((doc) => doc.assetPaths))];
const mainDoc = renderedDocs.find((doc) => doc.slug === 'sqlfu');
if (!mainDoc) {
  throw new Error('Missing main sqlfu README doc');
}

for (const assetPath of assetPaths) {
  const destinationPath = path.join(distRoot, assetRoute(assetPath));
  await fs.mkdir(path.dirname(destinationPath), {recursive: true});
  await fs.copyFile(assetPath, destinationPath);
}

await fs.writeFile(path.join(distRoot, 'index.html'), renderLandingPage(renderedDocs));
await fs.writeFile(path.join(distRoot, 'docs', 'index.html'), renderDocPage(mainDoc, renderedDocs));

for (const doc of renderedDocs) {
  const docDir = path.join(distRoot, 'docs', doc.slug);
  await fs.mkdir(docDir, {recursive: true});
  await fs.writeFile(path.join(docDir, 'index.html'), renderDocPage(doc, renderedDocs));
}

async function renderDoc(doc) {
  const markdown = await fs.readFile(doc.sourcePath, 'utf8');
  const renderer = createMarkdownRenderer(doc);
  const env = {
    headings: [],
    assetPaths: [],
  };
  let html = renderer.render(markdown, env);
  if (doc.slug === 'sqlfu') {
    html = html.replace('<ul>', '<ul class="inline-toc mobile-only">');
  }

  return {
    ...doc,
    markdown,
    html,
    headings: buildNestedHeadings(env.headings),
    assetPaths: env.assetPaths,
    sourceUrl: githubPermalink(doc.sourcePath),
  };
}

function createMarkdownRenderer(currentDoc) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });

  const defaultHeadingOpen = md.renderer.rules.heading_open
    ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const headingToken = tokens[index];
    const inlineToken = tokens[index + 1];
    const title = inlineToken?.type === 'inline' ? inlineToken.content.trim() : '';
    const id = slugify(title);
    headingToken.attrSet('id', id);
    env.headings ??= [];
    env.headings.push({
      level: Number(headingToken.tag.replace(/^h/, '')),
      title,
      id,
    });
    return defaultHeadingOpen(tokens, index, options, env, self);
  };

  const defaultLinkOpen = md.renderer.rules.link_open
    ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet('href');
    if (href) {
      const rewritten = rewriteHref(href, currentDoc.sourcePath);
      token.attrSet('href', rewritten.href);
      if (rewritten.external) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noreferrer');
      }
    }
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  const defaultImage = md.renderer.rules.image
    ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const src = token.attrGet('src');
    if (src) {
      const rewritten = rewriteImageSrc(src, currentDoc.sourcePath, env);
      token.attrSet('src', rewritten.src);
    }
    return defaultImage(tokens, index, options, env, self);
  };

  return md;
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
            <a class="button primary" href="/docs/">Read the docs</a>
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
          <p>${renderedDocs.map((doc) => `<a href="${docRoute(doc.slug)}">${escapeHtml(doc.title)}</a>`).join('<br />')}</p>
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
        <details class="docs-nav-shell">
          <summary class="docs-nav-toggle">
            <span class="docs-nav-toggle-icon" aria-hidden="true"></span>
            <span>Docs Menu</span>
          </summary>
          <nav class="docs-nav">
            <h2>Docs</h2>
            <div class="docs-group">
              ${renderedDocs.map((doc) => `<a class="doc-link ${doc.slug === currentDoc.slug ? 'active' : ''}" href="${doc.slug === 'sqlfu' ? '/docs/' : docRoute(doc.slug)}">${escapeHtml(doc.title)}</a>`).join('\n')}
            </div>
            ${currentDoc.headings.length > 0 ? `
              <h2>On This Page</h2>
              <div class="docs-group toc-list">
                ${renderTocItems(currentDoc.headings)}
              </div>
            ` : ''}
          </nav>
        </details>
        <article class="doc-panel">
          <div class="doc-meta"><a href="${currentDoc.sourceUrl}" target="_blank" rel="noreferrer">Source: ${escapeHtml(path.relative(repoRoot, currentDoc.sourcePath))}</a></div>
          <div class="doc-content">
            ${currentDoc.html}
          </div>
        </article>
      </section>
    `,
  });
}

function renderTocItems(items) {
  return items.map((item) => `
    <a class="toc-link toc-depth-${item.level}" href="#${item.id}">${escapeHtml(item.title)}</a>
    ${item.children.length > 0 ? renderTocItems(item.children) : ''}
  `).join('\n');
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
    '        <a href="/docs/">Docs</a>',
    '        <a href="/docs/">Quick Start</a>',
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

function buildNestedHeadings(headings) {
  const root = [];
  const stack = [];

  for (const heading of headings.filter((item) => item.level >= 1 && item.level <= 4)) {
    const node = {
      ...heading,
      children: [],
    };

    while (stack.length > 0 && stack.at(-1).level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack.at(-1).children.push(node);
    }

    stack.push(node);
  }

  return root;
}

function rewriteHref(href, currentSourcePath) {
  if (href.startsWith('#')) {
    return {href, external: false};
  }

  if (/^https?:\/\//.test(href)) {
    return {href, external: true};
  }

  const absoluteTarget = resolveRepoTarget(href, currentSourcePath);
  if (!absoluteTarget) {
    return {href, external: false};
  }

  const [absolutePath, hash] = String(absoluteTarget).split('#');
  const normalizedTarget = normalizePath(absolutePath);
  const linkedDoc = docBySourcePath.get(normalizedTarget);
  if (linkedDoc) {
    return {
      href: `${linkedDoc.slug === 'sqlfu' ? '/docs/' : docRoute(linkedDoc.slug)}${hash ? `#${hash}` : ''}`,
      external: false,
    };
  }

  return {
    href: githubPermalink(absoluteTarget),
    external: true,
  };
}

function rewriteImageSrc(src, currentSourcePath, env) {
  if (src.startsWith('#') || /^https?:\/\//.test(src) || src.startsWith('data:')) {
    return {src};
  }

  const absoluteTarget = resolveRepoTarget(src, currentSourcePath);
  if (!absoluteTarget) {
    return {src};
  }

  const [absolutePath] = String(absoluteTarget).split('#');
  env.assetPaths ??= [];
  env.assetPaths.push(absolutePath);

  return {
    src: assetRoute(absolutePath),
  };
}

function resolveRepoTarget(href, currentSourcePath) {
  const [rawPath, rawHash] = href.split('#');
  const cleanPath = rawPath.trim();
  if (!cleanPath) {
    return null;
  }

  const absolutePath = path.resolve(path.dirname(currentSourcePath), cleanPath);
  if (!normalizePath(absolutePath).startsWith(normalizePath(repoRoot) + '/')) {
    return null;
  }

  if (rawHash) {
    return `${absolutePath}#${rawHash}`;
  }

  return absolutePath;
}

function githubPermalink(repoPathWithHash) {
  const [repoPath, hash] = String(repoPathWithHash).split('#');
  const relativePath = path.relative(repoRoot, repoPath).split(path.sep).join('/');
  const suffix = hash ? `#${hash}` : '';
  return `${repositoryBaseUrl}/blob/${gitSha}/${relativePath}${suffix}`;
}

function normalizeRepositoryUrl(value) {
  return value.replace(/\.git$/u, '').replace(/^git@github\.com:/u, 'https://github.com/');
}

function readGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function docRoute(slug) {
  return `/docs/${slug}/`;
}

function assetRoute(assetPath) {
  const relativePath = path.relative(repoRoot, assetPath).split(path.sep).join('/');
  return `/docs/assets/${relativePath}`;
}

function normalizePath(value) {
  return path.resolve(value).split(path.sep).join('/');
}

function slugify(value) {
  return value
    .trim()
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
