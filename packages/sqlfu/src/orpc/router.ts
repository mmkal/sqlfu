export interface SqlfuFsLike {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
}

export interface SqlfuDatabaseLike {
  execute(sql: string): Promise<void>;
  exportSchema(): Promise<string>;
}

export type SqlfuCheckResult = 'ok' | `failure: ${string}`;

export interface SqlfuCheckReport {
  readonly ok: SqlfuCheckResult;
  readonly desiredVsHistory: SqlfuCheckResult;
  readonly finalizedVsSnapshot: SqlfuCheckResult;
  readonly databaseVsDesired: SqlfuCheckResult;
  readonly databaseVsFinalized: SqlfuCheckResult;
}

export interface SqlfuCaller {
  sync(): Promise<void>;
  migrate(): Promise<void>;
  draft(input?: {name?: string}): Promise<void>;
  check(): Promise<SqlfuCheckReport>;
}

export interface SqlfuRouterConfig {
  readonly definitionsPath: string;
  readonly migrationsDir: string;
  readonly snapshotPath: string;
  readonly dbPath: string;
}

export interface CreateSqlfuCallerOptions {
  readonly config: SqlfuRouterConfig;
  readonly fs: SqlfuFsLike;
  readonly db: SqlfuDatabaseLike;
}

type MigrationStatus = 'draft' | 'final';

type MigrationFile = {
  readonly fileName: string;
  readonly contents: string;
  readonly body: string;
  status(): MigrationStatus;
};

export function createSqlfuCaller(options: CreateSqlfuCallerOptions): SqlfuCaller {
  return {
    async sync() {
      const desiredSql = await options.fs.readFile(options.config.definitionsPath);
      await options.db.execute(desiredSql);
    },

    async migrate() {
      const migrations = await loadMigrations(options);
      const draftMigration = migrations.find((migration) => migration.status() === 'draft');
      if (draftMigration) {
        throw new Error(`draft migration must be finalized before migrate: ${draftMigration.fileName}`);
      }

      const snapshotSql = await options.fs.readFile(options.config.snapshotPath);
      await options.db.execute(snapshotSql);
    },

    async draft(input) {
      const desiredSql = await options.fs.readFile(options.config.definitionsPath);
      const snapshotSql = await options.fs.readFile(options.config.snapshotPath);
      const migrations = await loadMigrations(options);
      const existingDraft = migrations.find((migration) => migration.status() === 'draft');

      if (!existingDraft && !input?.name) {
        throw new Error('draft name is required when creating a new draft migration');
      }

      const draftSql = computeDraftSql(snapshotSql, desiredSql);
      const targetFileName = existingDraft?.fileName ?? `${nextMigrationId(migrations)}_${slugify(input?.name ?? 'draft')}.sql`;

      await options.fs.mkdir(options.config.migrationsDir);
      await options.fs.writeFile(
        joinPath(options.config.migrationsDir, targetFileName),
        `-- status: draft\n${draftSql}\n`,
      );
    },

    async check() {
      const definitionsSql = await options.fs.readFile(options.config.definitionsPath);
      const snapshotSql = await options.fs.readFile(options.config.snapshotPath);
      const migrations = await loadMigrations(options);
      const databaseSql = await options.db.exportSchema();

      const finalSql = migrations
        .filter((migration) => migration.status() === 'final')
        .map((migration) => migration.body)
        .join('\n');
      const draftSql = migrations.find((migration) => migration.status() === 'draft')?.body ?? '';
      const desiredVsHistory = compareSchemas(
        'desired schema does not match finalized history plus draft',
        definitionsSql,
        [snapshotSql, draftSql].filter(Boolean).join('\n'),
      );
      const finalizedVsSnapshot = compareSchemas(
        'finalized history does not match snapshot.sql',
        snapshotSql,
        finalSql,
      );
      const databaseVsDesired = compareSchemas(
        'database does not match desired schema',
        definitionsSql,
        databaseSql,
      );
      const databaseVsFinalized = compareSchemas(
        'database does not match finalized history',
        snapshotSql,
        databaseSql,
      );

      const failures = [desiredVsHistory, finalizedVsSnapshot, databaseVsDesired, databaseVsFinalized].filter(
        (result) => result !== 'ok',
      );

      return {
        ok: failures.length === 0 ? 'ok' : (`failure: ${failures.map((failure) => failure.slice('failure: '.length)).join('; ')}` as const),
        desiredVsHistory,
        finalizedVsSnapshot,
        databaseVsDesired,
        databaseVsFinalized,
      };
    },
  };
}

async function loadMigrations(options: CreateSqlfuCallerOptions): Promise<MigrationFile[]> {
  const exists = await options.fs.exists(options.config.migrationsDir);
  if (!exists) {
    return [];
  }

  const fileNames = (await options.fs.readdir(options.config.migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  return Promise.all(
    fileNames.map(async (fileName) => {
      const contents = await options.fs.readFile(joinPath(options.config.migrationsDir, fileName));
      return parseMigrationFile(fileName, contents);
    }),
  );
}

function parseMigrationFile(fileName: string, contents: string): MigrationFile {
  const lines = contents.split('\n');
  const statusLine = lines.find((line) => line.trim().startsWith('-- status:'));
  const statusValue = statusLine?.split(':')[1]?.trim();
  const body = lines
    .filter((line) => !line.trim().startsWith('-- status:'))
    .join('\n')
    .trim();

  return {
    fileName,
    contents,
    body,
    status() {
      return statusValue === 'draft' ? 'draft' : 'final';
    },
  };
}

function compareSchemas(message: string, leftSql: string, rightSql: string): SqlfuCheckResult {
  return normalizeSql(leftSql) === normalizeSql(rightSql) ? 'ok' : `failure: ${message}`;
}

function computeDraftSql(snapshotSql: string, definitionsSql: string): string {
  const snapshotStatements = new Set(splitStatements(snapshotSql));
  const nextStatements = splitStatements(definitionsSql).filter((statement) => !snapshotStatements.has(statement));
  return nextStatements.join('\n');
}

function normalizeSql(sql: string): string {
  return splitStatements(sql).join('\n');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'draft';
}

function joinPath(left: string, right: string): string {
  return `${left.replace(/\/+$/u, '')}/${right.replace(/^\/+/u, '')}`;
}

function nextMigrationId(migrations: readonly MigrationFile[]): string {
  const numericIds = migrations
    .map((migration) => migration.fileName.match(/^(\d+)_/u)?.[1])
    .filter((value): value is string => Boolean(value));

  if (numericIds.length === 0) {
    return '00000000000001';
  }

  const widest = Math.max(...numericIds.map((id) => id.length));
  const next = (BigInt(numericIds.sort().at(-1)!) + 1n).toString();
  return next.padStart(widest, '0');
}
