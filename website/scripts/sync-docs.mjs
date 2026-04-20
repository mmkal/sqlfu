import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(websiteRoot, '..');
const contentDocsDir = path.join(websiteRoot, 'src', 'content', 'docs', 'docs');
const publicAssetsRoot = path.join(websiteRoot, 'public', 'docs', 'assets');
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
    slug: 'runtime-validation',
    title: 'Runtime validation with zod',
    sourcePath: path.join(repoRoot, 'packages', 'sqlfu', 'docs', 'runtime-validation.md'),
    description: 'Generate zod schemas as the source of truth. Validate params and rows at the wrapper boundary.',
  },
  {
    slug: 'ui',
    title: 'UI',
    sourcePath: path.join(repoRoot, 'packages', 'ui', 'README.md'),
    description: 'The browser client and how it relates to the local backend server.',
  },
];

const docBySourcePath = new Map(docs.map((doc) => [normalizePath(doc.sourcePath), doc]));

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

  const destPath = path.join(contentDocsDir, `${doc.slug}.md`);
  await fs.writeFile(destPath, frontmatter + content);

  for (const assetPath of assetPaths) {
    const destinationPath = path.join(websiteRoot, 'public', 'docs', 'assets', path.relative(repoRoot, assetPath));
    await fs.mkdir(path.dirname(destinationPath), {recursive: true});
    await fs.copyFile(assetPath, destinationPath);
  }
}

console.log(`synced ${docs.length} docs into ${path.relative(websiteRoot, contentDocsDir)}`);

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
    return `/docs/${linkedDoc.slug}/${hash ? `#${hash}` : ''}`;
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
