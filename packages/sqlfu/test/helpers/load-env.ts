import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {config} from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnv = path.resolve(here, '../../../../.env');
config({path: repoRootEnv, quiet: true});
