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
    slug: 'observability',
    title: 'Observability',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'observability.md'),
    description: 'Named queries reach OpenTelemetry, Sentry, PostHog, Datadog via a single instrument() hook.',
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

await writeHtmlPage(path.join(distRoot, 'index.html'), renderLandingPage(renderedDocs));
await writeHtmlPage(path.join(distRoot, 'docs', 'index.html'), renderDocPage(mainDoc, renderedDocs));

for (const doc of renderedDocs) {
  const docDir = path.join(distRoot, 'docs', doc.slug);
  await fs.mkdir(docDir, {recursive: true});
  await writeHtmlPage(path.join(docDir, 'index.html'), renderDocPage(doc, renderedDocs));
}

// The build emits HTML with absolute paths like `/styles.css` and `/docs/`,
// which break whenever the site is served under a path prefix (e.g. the
// artifact.ci preview URL `/artifact/view/.../run/.../website/`). Rewrite
// them to paths relative to each file's own depth so the built `dist/` is
// portable to any base path.
async function writeHtmlPage(filePath, html) {
  const depth = path.relative(distRoot, path.dirname(filePath)).split(path.sep).filter(Boolean).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  const rewritten = html.replaceAll(/((?:href|src)=")\/([^"]*)"/g, (_match, attr, rest) => `${attr}${prefix}${rest}"`);
  await fs.writeFile(filePath, rewritten);
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
      if (rewritten.skipRender) {
        return '';
      }
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
      <section class="hero hero-solo">
        <article class="hero-main">
          <div class="eyebrow lowercase">npm install sqlfu</div>
          <h1>all you need is sql.</h1>
          <p class="lede">
            sqlfu lets you (or your agent) write schema, migrations, and queries as <code>.sql</code> files, and generates typed TypeScript wrappers next to them. Not the abstraction of the month.
          </p>
          <div class="cta-row">
            <a class="button primary" href="/docs/">Read the docs</a>
            <a class="button" href="https://local.sqlfu.dev/?demo=1">Try the demo</a>
          </div>
        </article>
      </section>

      <figure class="showreel">
        <img src="/docs/assets/packages/sqlfu/docs/i-know-sqlfu.webp" alt="I know sqlfu" />
      </figure>

      <h2 class="section-title">SQL first. TypeScript second.</h2>
      <section class="section-grid">
        <article class="panel value-panel">
          <div class="eyebrow">source of truth</div>
          <h3>Schema, migrations, queries. All <code>.sql</code>.</h3>
          <p>Your schema lives in <code>definitions.sql</code>. Migrations are ordered SQL files. Queries are <code>.sql</code> files checked in next to the code that calls them. No DSL, no runtime builder to fight.</p>
        </article>
        <article class="panel value-panel">
          <div class="eyebrow">types, generated</div>
          <h3>TypeScript wrappers <i>from</i> your SQL</h3>
          <p><code>sqlfu generate</code> reads your <code>.sql</code> files and emits typed wrappers next to them: typed params, typed rows, and a client you can call from application code. Your query names travel with them &mdash; to <a href="/docs/observability/">OpenTelemetry, Sentry, Datadog, PostHog</a>, whatever.</p>
        </article>
        <article class="panel value-panel">
          <div class="eyebrow">diff-driven migrations</div>
          <h3>Drafts your next migration</h3>
          <p>The native SQLite diff engine compares replayed migration history against <code>definitions.sql</code> and writes the next migration for you. You review, edit for renames or backfills, and commit.</p>
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
        <details class="docs-nav-shell" open>
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
        <script>
          (() => {
            const shell = document.currentScript.previousElementSibling;
            const mq = window.matchMedia('(max-width: 900px)');
            const apply = () => { if (mq.matches) shell.removeAttribute('open'); else shell.setAttribute('open', ''); };
            apply();
            mq.addEventListener('change', apply);
          })();
        </script>
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
    '        <a href="https://local.sqlfu.dev/?demo=1">Demo</a>',
    `        <a href="${repositoryBaseUrl}" target="_blank" rel="noreferrer">GitHub</a>`,
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
  const preferredAssetPath = preferWebpAsset(absolutePath);
  env.assetPaths ??= [];
  env.assetPaths.push(preferredAssetPath);

  return {
    src: assetRoute(preferredAssetPath),
    skipRender: /i-know-sqlfu\.(gif|webp)$/u.test(preferredAssetPath),
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

function preferWebpAsset(assetPath) {
  if (!assetPath.endsWith('.gif')) {
    return assetPath;
  }

  const webpPath = assetPath.replace(/\.gif$/u, '.webp');
  try {
    execFileSync('test', ['-f', webpPath], {cwd: repoRoot});
    return webpPath;
  } catch {
    return assetPath;
  }
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
