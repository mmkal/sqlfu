// important thing to maintain: the main index.ts export for the sqlfu package must be "light". it can only import runtime-safe stuff:
// - client
// - adapters (but rule for adapters: must be dependency free - no importing any actual modules like '@libsql/client' or 'bun:sqlite' - only sqlfu-owned XyzDatabaseLike *types*. users must pass in instances
// conforming to these types)
// - config/* (but rule for *config*: same as above! that should probably go as far as also meaning no node: imports. we are currently in violation and have a bunch of node: stuff in there)
// - types are fine
//
// this means we're overdue a refactor, but for now, just eliminate stuff from index.ts

export * from './client.js';
export * from './core/config.js';
export {prettifyStandardSchemaError} from './vendor/standard-schema/errors.js';
