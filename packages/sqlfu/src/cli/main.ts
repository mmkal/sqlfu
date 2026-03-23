#!/usr/bin/env node

import {createSqlfuCli} from './router.js';

await createSqlfuCli().run();
