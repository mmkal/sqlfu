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
} from '../api.js';
import {createDefaultInitPreview} from '../init-preview.js';
import {migrationName, readMigrationHistory} from '../migrations/index.js';
import {stopProcessesListeningOnPort} from './port-process.js';
import {generateQueryTypesForConfig} from '../typegen/index.js';
import {startSqlfuServer} from '../ui/server.js';
import {resolveSqlfuUi} from '../ui/resolve-sqlfu-ui.js';
import packageJson from '../../package.json' with {type: 'json'};
import {
  materializeDefinitionsSchemaForContext,
  materializeMigrationsSchemaForContext,
  compareSchemasForContext,
  readMigrationsFromContext,
} from '../api.js';

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
    .handler(async ({context}) => {
      const sqlfuContext = await loadContextConfig(context);
      await generateQueryTypesForConfig(sqlfuContext.config, sqlfuContext.host);
      return 'Generated schema-derived database and TypeSQL outputs.';
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
      await applyDraftSql(await loadContextConfig(context), input, context.confirm);
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
      const applied = await readMigrationHistory(database.client, {preset: migrationsPresetOf(initializedContext)});
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
      const applied = await readMigrationHistory(database.client, {preset: migrationsPresetOf(initializedContext)});
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
      const applied = await readMigrationHistory(database.client, {preset: migrationsPresetOf(initializedContext)});
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
      if ((await compareSchemasForContext(sqlfuContext.host, definitionsSchema, migrationsSchema)).isDifferent) {
        throw new Error('replayed migrations do not match definitions.sql');
      }
    }),
  },
};
