#!/usr/bin/env node
import { Command } from 'commander';
import { login } from './commands/login.js';
import { initProject } from './commands/init.js';
import { listTasks, reportTask, startTask } from './commands/task.js';
import { checkProject } from './commands/check.js';
import { clearSession, loadSession } from './auth.js';
import { ApiClient } from './api-client.js';

const program = new Command();
program.name('vibe').description('Vibe Plan project and Codex workflow CLI');
program.command('login').requiredOption('--server <url>').action(({ server }) => login(server));
program.command('logout').action(() => clearSession());
program.command('whoami').action(async () => {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  console.log(JSON.stringify(await new ApiClient(session.server, session).me(), null, 2));
});
program.command('init').requiredOption('--project-id <id>').option('--force').action(({ projectId, force }) => initProject(projectId, force));
program.command('task:list').action(listTasks);
program.command('task:start').argument('<id>').requiredOption('--version <number>').action((id, options) => startTask(id, Number(options.version)));
program.command('task:report').argument('<id>').requiredOption('--version <number>').requiredOption('--summary <text>').action((id, options) => reportTask(id, Number(options.version), options.summary));
program.command('check').action(() => checkProject());

await program.parseAsync();
