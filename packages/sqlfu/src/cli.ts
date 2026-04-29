#!/usr/bin/env node

export {createSqlfuCli, runSqlfuCli} from './node/sqlfu-cli.js';

import {runSqlfuCli} from './node/sqlfu-cli.js';

await runSqlfuCli(process.argv.slice(2));
