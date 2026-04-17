import {defineConfig} from 'sqlfu';

export default defineConfig({
  db: './db/app.sqlite',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
});
