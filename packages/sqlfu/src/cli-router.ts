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
  formatCheckFailure,
  requireContextConfig,
} from './api.js';
import {createDefaultInitPreview} from './core/init-preview.js';
import {migrationName, readMigrationHistory} from './migrations/index.js';
import {stopProcessesListeningOnPort} from './core/port-process.js';
import {generateQueryTypes} from './typegen/index.js';
import {startSqlfuServer} from './ui/server.js';
import {resolveSqlfuUi} from './ui/resolve-sqlfu-ui.js';
import packageJson from '../package.json' with {type: 'json'};
import {
  materializeDefinitionsSchemaForContext,
  materializeMigrationsSchemaForContext,
  compareSchemasForContext,
  readMigrationsFromContext,
} from './api.js';

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
      const ui = input?.ui ? resolveSqlfuUi({sqlfuVersion: packageJson.version}) : undefined;

      await startSqlfuServer({
        port: input?.port,
        projectRoot: context.projectRoot,
        ui: ui ? {root: ui.root} : undefined,
      });

      context.host.logger.log(
        ui ? `sqlfu ready (UI + backend on the same origin)` : 'sqlfu ready at https://sqlfu.dev/ui',
      );

      await new Promise(() => {});
    }),

  init: base
    .meta({
      description: `Initialize a new sqlfu project in the current directory.`,
    })
    .handler(async ({context}) => {
      const preview = createDefaultInitPreview(context.projectRoot);
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
        projectRoot: context.projectRoot,
        configContents,
      });

      return `Initialized sqlfu project in ${context.projectRoot}.`;
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
    .handler(async () => {
      await generateQueryTypes();
      return 'Generated schema-derived database and TypeSQL outputs.';
    }),

  config: base.handler(async ({context}) => {
    return requireContextConfig(context).config;
  }),

  sync: base
    .meta({
      description:
        `Update the current database to match definitions.sql. Note: this should only be used for local development. For production databases, use 'sqlfu migrate' instead. ` +
        `This command fails if semantic changes are required. You can run 'sqlfu draft' to create a migration file with the necessary changes.`,
    })
    .handler(async ({context}) => {
      await applySyncSql(requireContextConfig(context), context.confirm);
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
      await applyDraftSql(requireContextConfig(context), input, context.confirm);
    }),

  migrate: base
    .meta({
      description: `Apply pending migrations to the configured database.`,
    })
    .handler(async ({context}) => {
      await applyMigrateSql(requireContextConfig(context), context.confirm);
    }),

  pending: base
    .meta({
      description: `List migrations that exist but have not been applied to the configured database.`,
    })
    .handler(async ({context}) => {
      const initializedContext = requireContextConfig(context);
      const migrations = await readMigrationsFromContext(initializedContext);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client);
      const appliedNames = new Set(applied.map((migration) => migration.name));
      return migrations.map((migration) => migrationName(migration)).filter((name) => !appliedNames.has(name));
    }),

  applied: base
    .meta({
      description: `List migrations recorded in the configured database history.`,
    })
    .handler(async ({context}) => {
      const initializedContext = requireContextConfig(context);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client);
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
      const initializedContext = requireContextConfig(context);
      const migrations = await readMigrationsFromContext(initializedContext);
      await using database = await initializedContext.host.openDb(initializedContext.config);
      const applied = await readMigrationHistory(database.client);
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
      await applyBaselineSql(requireContextConfig(context), input, context.confirm);
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
      await applyGotoSql(requireContextConfig(context), input, context.confirm);
    }),

  check: {
    all: base
      .meta({
        description: `Run all checks and recommend the next action.`,
      })
      .handler(async ({context}) => {
        const analysis = await analyzeDatabase(requireContextConfig(context));
        if (analysis.mismatches.length > 0) {
          throw new Error(formatCheckFailure(analysis));
        }
      }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      const sqlfuContext = requireContextConfig(context);
      const [definitionsSql, migrations] = await Promise.all([
        sqlfuContext.host.fs.readFile(sqlfuContext.config.definitions),
        readMigrationsFromContext(sqlfuContext),
      ]);
      const [definitionsSchema, migrationsSchema] = await Promise.all([
        materializeDefinitionsSchemaForContext(sqlfuContext.host, definitionsSql),
        materializeMigrationsSchemaForContext(sqlfuContext.host, migrations),
      ]);
      if ((await compareSchemasForContext(sqlfuContext.host, definitionsSchema, migrationsSchema)).isDifferent) {
        throw new Error('replayed migrations do not match definitions.sql');
      }
    }),
  },
};
