import {createCli} from 'trpc-cli';
import {os} from '@orpc/server';

import {loadProjectConfig} from '../core/config.js';
import {sqlfuConfigInput, sqlfuRouter} from '../orpc/router.js';
import {generateQueryTypes} from '../typegen/index.js';

export const router = {
  generate: os.input(sqlfuConfigInput).handler(async ({input}) => {
    await generateQueryTypes(input);
    return 'Generated schema-derived database and TypeSQL outputs.';
  }),

  config: os.input(sqlfuConfigInput).handler(async ({input}) => {
    return loadProjectConfig(input);
  }),

  ...sqlfuRouter,
};

export function createSqlfuCli() {
  return createCli({
    router,
    name: 'sqlfu',
    context: {},
  });
}
