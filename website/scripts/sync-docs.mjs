import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import dedent from 'dedent';

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(websiteRoot, '..');
const contentDocsDir = path.join(websiteRoot, 'src', 'content', 'docs', 'docs');
const publicAssetsRoot = path.join(websiteRoot, 'public', 'docs', 'assets');
const gitSha = readGit(['rev-parse', 'HEAD']);
const repositoryBaseUrl = normalizeRepositoryUrl(readGit(['remote', 'get-url', 'origin']));

const docs = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'getting-started.md'),
    description: 'End-to-end walkthrough: schema, migrations, query files, typed wrappers, and a working client.all() call.',
  },
  {
    slug: 'sqlfu',
    title: 'Overview',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'README.md'),
    description: 'Overview, quick start, CLI model, and core concepts.',
  },
  {
    slug: 'adapters',
    title: 'Adapters',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'adapters.md'),
    description:
      'Drivers sqlfu supports out of the box: better-sqlite3, libsql, Turso Cloud, Cloudflare D1, Durable Objects, Expo, sqlite-wasm, and more.',
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
    slug: 'runtime-validation',
    title: 'Runtime validation',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'runtime-validation.mdx'),
    description:
      'Generate arktype, valibot, zod, or zod/mini schemas as the source of truth. Validate params and rows at the wrapper boundary.',
  },
  {
    slug: 'id-helpers',
    title: 'Pure-SQL id generators (ulid, ksuid, nanoid, cuid2)',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'id-helpers.md'),
    description: 'Copy-paste sqlite views for ULID, KSUID, nanoid, and cuid2-shaped ids — pure SQL, no extensions.',
  },
  {
    slug: 'ui',
    title: 'UI',
    sourcePath: path.join(repoRoot, 'packages', 'ui', 'README.md'),
    description: 'The browser client and how it relates to the local backend server.',
  },
  {
    slug: 'dynamic-queries',
    title: 'Dynamic queries',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'dynamic-queries.md'),
    description:
      'How to handle optional filters and other runtime-composition shapes in a SQL-first project — with IS NULL patterns, JSON lists, and honest advice on when to reach for a query builder instead.',
  },
  {
    slug: 'outbox',
    title: 'Outbox',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'outbox.md'),
    description:
      'Transactional-outbox / job-queue built on sqlfu. Fan-out, retry, delayed dispatch, crash recovery, causation chains.',
  },
  {
    slug: 'schema-diff-model',
    title: 'Schema Diff Model',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'schema-diff-model.md'),
    description: 'How sqlfu models SQLite schema diffing and migration planning.',
  },
  {
    slug: 'lint-plugin',
    title: 'Lint Plugin',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'lint-plugin.md'),
    description: 'ESLint rules for enforcing the SQL First model: query-naming and format-sql.',
  },
];

const docBySourcePath = new Map(docs.map((doc) => [normalizePath(doc.sourcePath), doc]));

const fixturesSourceDir = path.join(repoRoot, 'packages', 'sqlfu', 'test', 'generate', 'fixtures');
const fixturesSubdir = 'examples';

await fs.rm(contentDocsDir, {recursive: true, force: true});
await fs.mkdir(contentDocsDir, {recursive: true});
await fs.rm(publicAssetsRoot, {recursive: true, force: true});
await fs.mkdir(publicAssetsRoot, {recursive: true});

for (const doc of docs) {
  const raw = await fs.readFile(doc.sourcePath, 'utf8');
  const stripped = stripLeadingH1(raw);
  const {content, assetPaths} = await transformMarkdown(stripped, doc);

  const relativeSource = path.relative(repoRoot, doc.sourcePath).split(path.sep).join('/');
  const frontmatter = [
    '---',
    `title: ${yamlString(doc.title)}`,
    `description: ${yamlString(doc.description)}`,
    `sourcePath: ${yamlString(relativeSource)}`,
    `sourceUrl: ${yamlString(`${repositoryBaseUrl}/blob/${gitSha}/${relativeSource}`)}`,
    '---',
    '',
  ].join('\n');

  // Preserve the source extension so .mdx files (which import Astro components like
  // Starlight's <Tabs>) round-trip as .mdx into the Starlight content collection.
  const sourceExtension = path.extname(doc.sourcePath);
  const destPath = path.join(contentDocsDir, `${doc.slug}${sourceExtension}`);
  await fs.writeFile(destPath, frontmatter + content);

  for (const assetPath of assetPaths) {
    const destinationPath = path.join(websiteRoot, 'public', 'docs', 'assets', path.relative(repoRoot, assetPath));
    await fs.mkdir(path.dirname(destinationPath), {recursive: true});
    await fs.copyFile(assetPath, destinationPath);
  }
}

const fixtureCount = await syncGenerateFixtures();

console.log(
  `synced ${docs.length} docs and ${fixtureCount} generate fixtures into ${path.relative(websiteRoot, contentDocsDir)}`,
);

async function syncGenerateFixtures() {
  const examplesDir = path.join(contentDocsDir, fixturesSubdir);
  await fs.mkdir(examplesDir, {recursive: true});

  const entries = (await fs.readdir(fixturesSourceDir, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const overviewEntries = [];

  for (const entry of entries) {
    const sourcePath = path.join(fixturesSourceDir, entry.name);
    const raw = await fs.readFile(sourcePath, 'utf8');
    const slug = entry.name.replace(/\.md$/, '');
    const {intro, body} = splitIntroAndBody(raw);
    const transformed = transformFixtureBody(body);

    const relativeSource = path.relative(repoRoot, sourcePath).split(path.sep).join('/');
    const title = titleForFixture(slug);
    const description = descriptionForIntro(intro, slug);
    const frontmatter = [
      '---',
      `title: ${yamlString(title)}`,
      `description: ${yamlString(description)}`,
      `sourcePath: ${yamlString(relativeSource)}`,
      `sourceUrl: ${yamlString(`${repositoryBaseUrl}/blob/${gitSha}/${relativeSource}`)}`,
      '---',
      '',
    ].join('\n');

    const destPath = path.join(examplesDir, `${slug}.md`);
    const intoDoc = intro ? `${intro}\n\n${transformed}` : transformed;
    await fs.writeFile(destPath, frontmatter + intoDoc);

    overviewEntries.push({slug, title, description});
  }

  await writeExamplesOverview(overviewEntries);
  return entries.length;
}

async function writeExamplesOverview(overviewEntries) {
  const relativeSource = path
    .relative(repoRoot, fixturesSourceDir)
    .split(path.sep)
    .join('/');

  const frontmatter = [
    '---',
    `title: ${yamlString('Generate examples')}`,
    `description: ${yamlString(
      'Executable snapshot fixtures for the `sqlfu generate` command. Each example below is a live test.',
    )}`,
    `sourcePath: ${yamlString(relativeSource)}`,
    `sourceUrl: ${yamlString(`${repositoryBaseUrl}/tree/${gitSha}/${relativeSource}`)}`,
    '---',
    '',
  ].join('\n');

  const pageLinks = overviewEntries
    .map(({slug, title, description}) => `- **[${title}](/docs/examples/${slug})** — ${description}`)
    .join('\n');

  const body = dedent`
    These pages are snapshot fixtures from \`packages/sqlfu/test/generate/fixtures/\`. Each \`##\`
    heading you'll find inside is a real test: the test harness parses the same markdown,
    runs \`sqlfu generate\` against the declared inputs, and asserts the outputs match what's
    shown. That means every TypeScript file under an **output** block on these pages is
    exactly what you'd find in your checkout after running the CLI — there is no drift.

    Start here if you want to see what \`sqlfu generate\` produces for a given schema shape,
    query style, or config knob, before you try it in your own project.

    ## Pages

    ${pageLinks}
  ` + '\n';

  await fs.writeFile(path.join(contentDocsDir, 'examples.md'), frontmatter + body);
}

function splitIntroAndBody(markdown) {
  // The fixture intro is a free-floating paragraph at the top of the file, ending at the first
  // line that begins with `<details>`. Anchoring to start-of-line avoids triggering on the word
  // "<details>" used in the prose itself.
  const match = markdown.match(/^<details[\s>]/m);
  if (!match) {
    return {intro: markdown.trim(), body: ''};
  }

  const detailsStart = match.index;
  return {intro: markdown.slice(0, detailsStart).trim(), body: markdown.slice(detailsStart)};
}

function descriptionForIntro(intro, slug) {
  if (!intro) {
    return `Generate fixtures — ${slug}`;
  }

  // Collapse newlines so YAML on a single line isn't forced to wrap, and trim to one sentence
  // for the page's `<meta name="description">`. The sentence terminator must be followed by
  // whitespace or end-of-string so internal dots (`.ts`, `U.K.`) don't split the sentence.
  const flat = intro.replace(/\s+/g, ' ').trim();
  const firstSentence = flat.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return firstSentence ? firstSentence[0].trim() : flat.slice(0, 180);
}

function transformFixtureBody(body) {
  // Rewrite ```ts (sql/foo.ts) into ```ts title="sql/foo.ts" so Starlight's expressive-code
  // renders the filename as a caption above each code block.
  return body.replace(/^(```[\w-]+)\s*\(([^)]+)\)\s*$/gm, (_match, fence, filePath) => {
    return `${fence} title="${filePath.trim()}"`;
  });
}

function titleForFixture(slug) {
  // Sentence case ("Query shapes"), matching the sidebar labels in astro.config.mjs.
  const prose = slug.replace(/-/g, ' ');
  return prose[0].toUpperCase() + prose.slice(1);
}

async function transformMarkdown(markdown, currentDoc) {
  const assetPaths = [];

  // Rewrite markdown image syntax: ![alt](src)
  let out = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
    const src = rawSrc.trim();
    if (/^(https?:|data:|#)/.test(src)) {
      return match;
    }

    const absoluteTarget = resolveRepoTarget(src, currentDoc.sourcePath);
    if (!absoluteTarget) {
      return match;
    }

    const [absolutePath] = String(absoluteTarget).split('#');
    const preferredAssetPath = preferWebpAsset(absolutePath);
    assetPaths.push(preferredAssetPath);
    // The i-know-sqlfu hero image lives on the landing page; don't duplicate it in the doc body.
    if (/i-know-sqlfu\.(gif|webp)$/u.test(preferredAssetPath)) {
      return '';
    }

    return `![${alt}](${assetRoute(preferredAssetPath)})`;
  });

  // Rewrite HTML <img src="..."> with a relative src. We don't rewrite the
  // surrounding tag — `align`, `width`, etc. pass through for rendering.
  out = out.replace(/<img\b([^>]*?)\bsrc\s*=\s*"([^"]+)"([^>]*)>/g, (match, before, rawSrc, after) => {
    const src = rawSrc.trim();
    if (/^(https?:|data:|#|\/)/.test(src)) {
      return match;
    }

    const absoluteTarget = resolveRepoTarget(src, currentDoc.sourcePath);
    if (!absoluteTarget) {
      return match;
    }

    const [absolutePath] = String(absoluteTarget).split('#');
    const preferredAssetPath = preferWebpAsset(absolutePath);
    assetPaths.push(preferredAssetPath);
    return `<img${before}src="${assetRoute(preferredAssetPath)}"${after}>`;
  });

  // Rewrite markdown link syntax: [text](href) (not preceded by !)
  out = out.replace(/(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g, (_match, prefix, text, rawHref) => {
    const href = rawHref.trim();
    const rewritten = rewriteHref(href, currentDoc.sourcePath);
    return `${prefix}[${text}](${rewritten})`;
  });

  return {content: out, assetPaths};
}

function stripLeadingH1(markdown) {
  // Starlight renders title from frontmatter, so drop the first h1 to avoid duplication.
  return markdown.replace(/^#\s+[^\n]*\n+/, '');
}

function rewriteHref(href, currentSourcePath) {
  if (href.startsWith('#')) {
    return href;
  }

  if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) {
    return href;
  }

  const absoluteTarget = resolveRepoTarget(href, currentSourcePath);
  if (!absoluteTarget) {
    return href;
  }

  const [absolutePath, hash] = String(absoluteTarget).split('#');
  const normalizedTarget = normalizePath(absolutePath);
  const linkedDoc = docBySourcePath.get(normalizedTarget);
  if (linkedDoc) {
    return `/docs/${linkedDoc.slug}${hash ? `#${hash}` : ''}`;
  }

  return githubPermalink(absoluteTarget);
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

function yamlString(value) {
  return JSON.stringify(value);
}
