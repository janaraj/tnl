#!/usr/bin/env node
import { runCli } from './cli.js';
import './commands/init.js';
import './commands/resolve.js';
import './commands/impacted.js';
import './commands/diff.js';
import './commands/verify.js';
import './commands/hook.js';
import './commands/test-plan.js';

const code = await runCli(process.argv.slice(2));
process.exit(code);
