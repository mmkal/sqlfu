import {os} from '@orpc/server';
import {z} from 'zod';

import {
  type SqlfuCommandRouterContext,
  applyBaselineSql,
  applyDraftSql,
  applyGotoSql,
  applyMigrateSql,
  applySyncSql,
  analyzeDatabase,
  autoAcceptConfirm,
  formatCheckFailure,
  loadContextConfig,
  loadContextProjectState,
  migrationsPresetOf,
} from '../api/internal.js';
import {createDefaultInitPreview} from '../init-preview.js';
import {migrationName, readMigrationHistory} from '../migrations/index.js';
import {formatSqlFiles} from './format-files.js';
import {stopProcessesListeningOnPort} from './port-process.js';
import {generateQueryTypesForConfig} from '../typegen/index.js';
import {watchGenerateQueryTypesForConfig} from '../typegen/watch.js';
import {
  draftInlineConfigMigration,
  generateInlineConfigModule,
  watchGenerateInlineConfigModule,
} from './inline-commands.js';
import {startSqlfuServer} from '../ui/server.js';
import {resolveSqlfuUi} from '../ui/resolve-sqlfu-ui.js';
import packageJson from '../../package.json' with {type: 'json'};
import {
  materializeDefinitionsSchemaForContext,
  materializeMigrationsSchemaForContext,
  compareSchemasForContext,
  readMigrationsFromContext,
} from '../api/internal.js';

const base = os.$context<SqlfuCommandRouterContext>();

export const router = {
  serve: base
    .meta({
      default: true,
      description: `Start the local sqlfu backend server used by the hosted studio at sqlfu.dev/ui.`,
    })
    .input(
      z
        .object({
          port: z.number().int().positive(),
          ui: z
            .boolean()
            .describe(
              `Also serve @sqlfu/ui on the same port. Requires @sqlfu/ui@${packageJson.version} to be installed.`,
            ),
        })
        .partial()
        .optional(),
    )
    .handler(async ({context, input}) => {
      const project = await loadContextProjectState(context);
      const params = {port: input?.port, configPath: project.configPath};
      if (input?.ui) {
        const ui = await resolveSqlfuUi({sqlfuVersion: packageJson.version});
        await startSqlfuServer({...params, ui});
        context.host.logger.log(`sqlfu ready at http://localhost:${params.port || 56081}`);
      } else {
        await startSqlfuServer(params);
        context.host.logger.log('sqlfu ready at https://sqlfu.dev/ui');
      }

      await new Promise(() => {});
    }),

  init: base
    .meta({
      description: `Initialize a new sqlfu project in the current directory.`,
    })
    .handler(async ({context}) => {
      const project = await loadContextProjectState(context);
      const preview = createDefaultInitPreview(project.projectRoot, {configPath: project.configPath});
      const configContents = await context.confirm({
        title: 'Create sqlfu.config.ts?',
        body: preview.configContents,
        bodyType: 'typescript',
        editable: true,
      });

      if (!configContents?.trim()) {
        return 'Initialization cancelled.';
      }

      await context.host.initializeProject({
        projectRoot: project.projectRoot,
        configPath: project.configPath,
        configContents,
      });

      return `Initialized sqlfu project in ${project.projectRoot}.`;
    }),

  kill: base
    .meta({
      description: `Stop the process listening on the local sqlfu backend port.`,
    })
    .input(
      z
        .object({
          port: z.number().int().positive(),
        })
        .partial()
        .optional(),
    )
    .handler(async ({input}) => {
      const port = input?.port || 56081;
      const stopped = await stopProcessesListeningOnPort(port);

      if (stopped.length === 0) {
        return `No process listening on port ${port}.`;
      }

      return `Stopped process on port ${port}: ${stopped.map((process) => (process.command ? `${process.command} (${process.pid})` : String(process.pid))).join(', ')}`;
    }),

  generate: base
    .meta({
      description: `Generate TypeScript functions for all queries in the sql/ directory.`,
    })
    .input(
      z
        .object({
          watch: z
            .boolean()
            .describe(
              `Run generate once, then re-run whenever a query, definitions.sql, or migration file changes. Exits on SIGINT.`,
            ),
        })
        .partial()
        .optional(),
    )
    .handler(async ({context, input}) => {
      const project = await loadContextProjectState(context);
      if (project.initialized && 'inline' in project) {
        if (input?.watch) {
          await watchGenerateInlineConfigModule({
            modulePath: project.inline.modulePath,
            projectRoot: project.projectRoot,
            host: context.host,
          });
          return;
        }
        const result = await generateInlineConfigModule({
          modulePath: project.inline.modulePath,
          projectRoot: project.projectRoot,
          host: context.host,
        });
        return formatGenerateResult(result.writtenFiles);
      }
      const sqlfuContext = await loadContextConfig(context);
      if (input?.watch) {
        await watchGenerateQueryTypesForConfig(sqlfuContext.config, sqlfuContext.host);
        return;
      }
      const result = await generateQueryTypesForConfig(sqlfuContext.config, sqlfuContext.host);
      return formatGenerateResult(result.writtenFiles);
    }),

  format: base
    .meta({
      description: `Format .sql files in place.`,
    })
    .input(
      z.object({
        paths: z
          .array(z.string().min(1))
          .min(1)
          .meta({positional: true})
          .describe('One or more .sql file paths or glob patterns.'),
      }),
    )
    .handler(async ({context, input}) => {
      // Use the project's configured dialect if there's a sqlfu project
      // visible from cwd; otherwise fall back to the default sqlite
      // formatter. `format` should still work as a one-off `.sql`
      // beautifier outside a project.
      const language = await detectFormatLanguage(context);
      const result = await formatSqlFiles(input.paths, process.cwd(), {language});
      const lines: string[] = [];
      if (result.formatted.length > 0) {
        lines.push('Formatted files:', ...result.formatted.map((filePath) => `  ${filePath}`));
      }
      if (result.unchanged.length > 0) {
        lines.push('Already formatted:', ...result.unchanged.map((filePath) => `  ${filePath}`));
      }
      return lines.join('\n');
    }),

  config: base.handler(async ({context}) => {
    return (await loadContextConfig(context)).config;
  }),

  sync: base
    .meta({
      description:
        `Update the current database to match definitions.sql. Note: this should only be used for local development. For production databases, use 'sqlfu migrate' instead. ` +
        `This command fails if semantic changes are required. You can run 'sqlfu draft' to create a migration file with the necessary changes.`,
    })
    .handler(async ({context}) => {
      await applySyncSql(await loadContextConfig(context), context.confirm);
    }),

  draft: base
    .meta({
      description: `Create a migration file from the diff between replayed migrations and definitions.sql.`,
    })
    .input(
      z
        .object({
          name: z
            .string()
            .min(1)
            .describe('The name of the migration to create. If omitted one is derived from the drafted SQL.'),
        })
        .partial()
        .optional(),
    )
    .handler(async ({context, input}) => {
      const project = await loadContextProjectState(context);
      if (project.initialized && 'inline' in project) {
        const result = await draftInlineConfigMigration({
          modulePath: project.inline.modulePath,
          projectRoot: project.projectRoot,
          host: context.host,
          name: input?.name,
          confirm: context.confirm,
        });
        return result ? `Wrote ${result.path}` : undefined;
      }
      const result = await applyDraftSql(await loadContextConfig(context), input, context.confirm);
      return result ? `Wrote ${result.path}` : undefined;
    }),

  migrate: base
    .meta({
      description: `Apply pending migrations to the configured database.`,
      aliases: {options: {yes: 'y'}},
    })
    .input(
      z
        .object({
          yes: z
            .boolean()
            .describe(
              `Skip the confirmation prompt and apply pending migrations. Defaults to true when stdin is not a TTY (e.g. CI, piped invocations), false otherwise.`,
            ),
        })
        .partial()
        .optional(),
    )
    .handler(async ({context, input}) => {
      const yes = input?.yes ?? !process.stdin.isTTY;
      await applyMigrateSql(await loadContextConfig(context), yes ? autoAcceptConfirm : context.confirm);
    }),

  pending: base
    .meta({
      description: `List migrations that exist but have not been applied to the configured database.`,
    })
    .handler(async ({context}) => {
      const initializedContext = await loadContextConfig(context);
      const migrations = await readMigrationsFromContext(initializedContext);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client, {
        preset: migrationsPresetOf(initializedContext),
        dialect: initializedContext.config.dialect,
      });
      const appliedNames = new Set(applied.map((migration) => migration.name));
      return migrations.map((migration) => migrationName(migration)).filter((name) => !appliedNames.has(name));
    }),

  applied: base
    .meta({
      description: `List migrations recorded in the configured database history.`,
    })
    .handler(async ({context}) => {
      const initializedContext = await loadContextConfig(context);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client, {
        preset: migrationsPresetOf(initializedContext),
        dialect: initializedContext.config.dialect,
      });
      return applied.map((migration) => migration.name);
    }),

  find: base
    .meta({
      description: `Find migrations by substring and show whether each one is applied.`,
    })
    .input(
      z.object({
        text: z.string().min(1),
      }),
    )
    .handler(async ({context, input}) => {
      const initializedContext = await loadContextConfig(context);
      const migrations = await readMigrationsFromContext(initializedContext);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client, {
        preset: migrationsPresetOf(initializedContext),
        dialect: initializedContext.config.dialect,
      });
      const appliedNames = new Set(applied.map((migration) => migration.name));
      return migrations
        .map((migration) => migrationName(migration))
        .filter((name) => name.includes(input.text))
        .map((name) => ({
          name,
          applied: appliedNames.has(name),
        }));
    }),

  baseline: base
    .meta({
      description: `Set migration history to an exact target without changing the live schema.`,
    })
    .input(
      z.object({
        target: z.string().min(1),
      }),
    )
    .handler(async ({context, input}) => {
      await applyBaselineSql(await loadContextConfig(context), input, context.confirm);
    }),

  goto: base
    .meta({
      description: `Change the database schema and migration history to match an exact migration target.`,
    })
    .input(
      z.object({
        target: z.string().min(1).meta({positional: true}),
      }),
    )
    .handler(async ({context, input}) => {
      await applyGotoSql(await loadContextConfig(context), input, context.confirm);
    }),

  check: {
    all: base
      .meta({
        description: `Run all checks and recommend the next action.`,
        // `default: true` makes `sqlfu check` (with no leaf specified)
        // auto-dispatch here, instead of opening a clack picker that hangs
        // when stdin isn't a TTY (CI, package.json scripts, piped invocations).
        default: true,
      })
      .handler(async ({context}) => {
        const analysis = await analyzeDatabase(await loadContextConfig(context));
        if (analysis.mismatches.length > 0) {
          throw new Error(formatCheckFailure(analysis));
        }
      }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      const sqlfuContext = await loadContextConfig(context);
      const [definitionsSql, migrations] = await Promise.all([
        sqlfuContext.host.fs.readFile(sqlfuContext.config.definitions),
        readMigrationsFromContext(sqlfuContext),
      ]);
      const [definitionsSchema, migrationsSchema] = await Promise.all([
        materializeDefinitionsSchemaForContext(sqlfuContext, definitionsSql),
        materializeMigrationsSchemaForContext(sqlfuContext, migrations),
      ]);
      if ((await compareSchemasForContext(sqlfuContext, definitionsSchema, migrationsSchema)).isDifferent) {
        throw new Error('replayed migrations do not match definitions.sql');
      }
    }),
  },
};

function formatGenerateResult(writtenFiles: string[]): string {
  if (writtenFiles.length === 0) {
    return 'No generated files changed.';
  }
  return ['Updated generated files:', ...writtenFiles.map((filePath) => `  ${filePath}`)].join('\n');
}

/**
 * Pick a sql-formatter dialect for `sqlfu format`. Reads the project's
 * configured dialect when one's loadable; falls back to sqlite (the
 * default) when there's no project — `sqlfu format` is also useful as a
 * one-shot file beautifier outside any project context.
 */
async function detectFormatLanguage(context: SqlfuCommandRouterContext): Promise<'sqlite' | 'postgresql' | undefined> {
  try {
    const project = await loadContextProjectState(context);
    if (!project.initialized) return undefined;
    if ('inline' in project) return 'sqlite';
    return project.config.dialect.name === 'postgresql' ? 'postgresql' : 'sqlite';
  } catch {
    return undefined;
  }
}
