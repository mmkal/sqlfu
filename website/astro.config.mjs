import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://sqlfu.dev',
  // build.format: 'file' emits `docs/runtime-validation.html` (not
  // `docs/runtime-validation/index.html`) so artifact.ci's "strip trailing slash"
  // 308 redirect doesn't change how the browser resolves relative asset URLs —
  // the last path segment is always treated as a filename either way.
  trailingSlash: 'ignore',
  build: {
    format: 'file',
  },
  redirects: {
    '/docs': '/docs/getting-started',
  },
  integrations: [
    starlight({
      title: 'sqlfu',
      favicon: '/favicon.ico',
      logo: {src: './src/assets/logo.png', alt: 'sqlfu'},
      head: [
        {tag: 'link', attrs: {rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png'}},
        {tag: 'link', attrs: {rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png'}},
        {tag: 'link', attrs: {rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png'}},
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        // Inject the "Source: …" GitHub permalink above each doc title.
        PageTitle: './src/starlight-overrides/PageTitle.astro',
        // Global pre-alpha notice on every docs page.
        Banner: './src/starlight-overrides/Banner.astro',
      },
      sidebar: [
        {label: 'Getting Started', slug: 'docs/getting-started'},
        {label: 'Overview', slug: 'docs/sqlfu'},
        {label: 'Adapters', slug: 'docs/adapters'},
        {label: 'Migration Model', slug: 'docs/migration-model'},
        {label: 'Runtime validation', slug: 'docs/runtime-validation'},
        {label: 'Dynamic queries', slug: 'docs/dynamic-queries'},
        {label: 'Outbox', slug: 'docs/outbox'},
        {
          label: 'Generate examples',
          items: [
            {label: 'Overview', slug: 'docs/examples'},
            {label: 'Basics', slug: 'docs/examples/basics'},
            {label: 'Config', slug: 'docs/examples/config'},
            {label: 'Errors', slug: 'docs/examples/errors'},
            {label: 'Query shapes', slug: 'docs/examples/query-shapes'},
            {label: 'Result types', slug: 'docs/examples/result-types'},
            {label: 'Validators', slug: 'docs/examples/validators'},
          ],
        },
        {label: 'Observability', slug: 'docs/observability'},
        {label: 'UI', slug: 'docs/ui'},
        {label: 'Lint Plugin', slug: 'docs/lint-plugin'},
        {label: 'Schema Diff Model', slug: 'docs/schema-diff-model'},
      ],
      social: [{icon: 'github', label: 'GitHub', href: 'https://github.com/mmkal/sqlfu'}],
    }),
  ],
});
