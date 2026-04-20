import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://www.sqlfu.dev',
  // build.format: 'file' emits `docs/runtime-validation.html` (not
  // `docs/runtime-validation/index.html`) so artifact.ci's "strip trailing slash"
  // 308 redirect doesn't change how the browser resolves relative asset URLs —
  // the last path segment is always treated as a filename either way.
  trailingSlash: 'ignore',
  build: {
    format: 'file',
  },
  redirects: {
    '/docs': '/docs/sqlfu',
  },
  integrations: [
    starlight({
      title: 'sqlfu',
      customCss: ['./src/styles/custom.css'],
      components: {
        // Inject the "Source: …" GitHub permalink above each doc title.
        PageTitle: './src/starlight-overrides/PageTitle.astro',
      },
      sidebar: [
        {label: 'sqlfu', slug: 'docs/sqlfu'},
        {label: 'Schema Diff Model', slug: 'docs/schema-diff-model'},
        {label: 'Migration Model', slug: 'docs/migration-model'},
        {label: 'Observability', slug: 'docs/observability'},
        {label: 'Runtime validation', slug: 'docs/runtime-validation'},
        {label: 'UI', slug: 'docs/ui'},
      ],
      social: [{icon: 'github', label: 'GitHub', href: 'https://github.com/mmkal/sqlfu'}],
    }),
  ],
});
