import {defineConfig} from 'sqlfu';

export default defineConfig({
  db: './db/app.sqlite',
  migrationsDir: './migrations',
  definitionsPath: './definitions.sql',
  sqlDir: './sql',
});
