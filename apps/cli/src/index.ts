#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { login } from './commands/login.js';
import { initProject } from './commands/init.js';
import { acceptTask, listTasks, reportTask, startTask, logTask, correctTaskLog } from './commands/task.js';
import { createTask } from './commands/task-create.js';
import { showTask } from './commands/task-show.js';
import { installCodexSkill } from './commands/install-codex.js';
import { installClaudeInstructions } from './commands/install-claude.js';
import { syncTasks, inspectPending } from './commands/sync.js';
import { runDaemon } from './commands/daemon.js';
import { daemonStatus, startDaemon, stopDaemon } from './commands/lifecycle.js';
import { startWithLogin } from './commands/start.js';
import { followDaemonLogs, readRecentDaemonLogs } from './commands/logs.js';
import { checkWithStatus } from './commands/check.js';
import { collectStatus, renderStatus, statusDependencies } from './commands/status.js';
import { clearSession, loadSession } from './auth.js';
import { ApiClient } from './api-client.js';
import { loadProjectConfig } from './config.js';
import { cliVersion } from './version.js';
import { AuthenticationRequiredError, chooseLogin, cliErrorMessage, requireSession } from './errors.js';
import { normalizeTaskVersionOption } from './command-args.js';
import { discardPausedOutbox, listOutbox } from './sync/outbox.js';
import { buildReportOptions, readReportFile, updateTaskProgress, uploadTaskPlan } from './commands/execution.js';
import { taskContext, updateTask } from './commands/maintenance.js';
import { collectGitReport } from './git-evidence.js';
import { preparePlan, runPlan, planStatus } from './commands/plan.js';

const program = new Command();
program.name('vibeplan').description('Vibe Plan project and Codex workflow CLI').version(cliVersion, '-v, --version', 'display the installed CLI version');
const publicCommands = new Set(['login', 'logout', 'install-codex', 'install-claude', 'check', 'start', 'stop', 'status', 'logs', 'sync:pending', 'sync:discard', 'plan:status']);
let startLoginAttempted = false;
program.hook('preAction', async (_command, actionCommand) => {
  if (!publicCommands.has(actionCommand.name())) await requireSession();
});
program.command('login').option('--server <url>', 'Vibe Plan server URL', 'https://vibeplan.szxinjin.cn').action(({ server }) => login(server));
program.command('logout').action(() => clearSession());
program.command('whoami').action(async () => {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  console.log(JSON.stringify(await new ApiClient(session.server, session).me(), null, 2));
});
program.command('init').requiredOption('--project-id <id>').option('--force').action(({ projectId, force }) => initProject(projectId, force));
program.command('task:list').action(listTasks);
program.command('plan:prepare').option('--file <path>', 'New manifest path', '.vibe/batch-plan.json').option('--task <id>', 'Select a leaf task (repeatable)', (value, previous: string[] = []) => [...previous, value], []).option('--check <json>', 'Approved check argv as a JSON array (repeatable)', (value, previous: string[] = []) => [...previous, value], []).description('Snapshot tasks for explicitly authorized local batch execution').action(preparePlan);
program.command('plan:run').option('--file <path>', 'Reviewed manifest', '.vibe/batch-plan.json').option('--approve', 'Authorize frozen task scope and local check commands').option('--auto-accept', 'Authorize permission-checked AI acceptance after tests and separate review').option('--resume', 'Resume inspected local execution record').description('Execute an authorized plan with local Codex and genuine checks').action(runPlan);
program.command('plan:status').option('--file <path>', 'Manifest path', '.vibe/batch-plan.json').description('Inspect persisted batch result and log path').action(({ file }) => planStatus(file));
program.command('task:create').requiredOption('--title <text>').requiredOption('--type <type>').requiredOption('--status <status>').requiredOption('--priority <priority>').option('--due-date <date>').requiredOption('--estimate <days>').requiredOption('--description <text>').requiredOption('--acceptance <text>', 'Acceptance criterion', (value, previous: string[] = []) => [...previous, value], []).action((options) => createTask({ ...options, dueDate: options.dueDate }));
program.command('task:show').argument('<id>').action(showTask);
program.command('task:context').argument('<id>').description('Read plan, review issues, recent activity and local Git context for AI handoff').action(taskContext);
program.command('task:update').argument('<id>').requiredOption('--task-version <number>').requiredOption('--file <path>', 'Scoped JSON patch; status changes require an explanation').description('Maintain an authorized task without bypassing review').action((id, options) => updateTask(id, Number(options.taskVersion), options.file));
program.command('install-codex').option('--force', 'Replace the existing Vibe Plan Skill').action(({ force }) => { installCodexSkill(undefined, force); });
program.command('install-claude').option('--force', 'Replace an existing unmarked CLAUDE.md after backing it up').description('Install managed Vibe Plan instructions for Claude Code in the current project').action(({ force }) => { installClaudeInstructions(process.cwd(), force); });
program.command('task:sync').action(() => syncTasks());
program.command('sync:pending').description('Inspect queued and paused operations').action(async () => console.log(JSON.stringify(await inspectPending(), null, 2)));
program.command('sync:discard').argument('<event-id>').description('Discard a paused operation after resolving its conflict').action((id) => { discardPausedOutbox(id); console.log('Paused operation discarded. Reread the task before submitting a replacement.'); });
program.command('daemon').option('--foreground').option('--instance-id <id>').action(({ instanceId }) => runDaemon(process.cwd(), 2000, instanceId));
program.command('start').action(async () => {
  const result = await startWithLogin(startDaemon, async (server) => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
    startLoginAttempted = true;
    if (!await offerLogin()) return false;
    await login(server ?? 'https://vibeplan.szxinjin.cn');
    return true;
  });
  console.log(result.alreadyRunning ? `Vibe Plan 已在当前项目运行（PID ${result.pid}）。` : `Vibe Plan 后台同步已启动（PID ${result.pid}）。`);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    console.log('正在显示同步日志；按 Ctrl-C 退出查看，后台同步继续运行。');
    await followDaemonLogs();
  }
});
program.command('stop').action(async () => { console.log(await stopDaemon() ? '当前项目的 Vibe Plan 后台同步已停止。' : '当前项目没有可验证的运行中后台。'); });
program.command('status').option('--verbose', '显示绑定、Git 与日志详情').option('--json', '输出 JSON，供脚本读取').action(async ({ verbose, json }) => {
  const status = await collectStatus(process.cwd(), statusDependencies(cliVersion, { loadSession, createClient: (server, session) => new ApiClient(server, session), loadProjectConfig }));
  process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : renderStatus(status, verbose));
});
program.command('logs').option('-f, --follow', '持续显示新日志').action(async ({ follow }) => {
  const status = daemonStatus();
  console.log(status.running ? `当前项目后台运行中（PID ${status.pid}）。` : '当前项目后台未运行。');
  if (follow) {
    console.log('正在显示同步日志；按 Ctrl-C 退出查看，后台同步继续运行。');
    await followDaemonLogs();
  } else {
    const recent = readRecentDaemonLogs();
    process.stdout.write(recent || '当前项目暂无同步日志。\n');
  }
});
program.command('task:start').argument('<id>').requiredOption('--task-version <number>').action((id, options) => startTask(id, Number(options.taskVersion)));
program.command('task:log').argument('<id>').requiredOption('--hours <number>').requiredOption('--content <text>').option('--date <date>').action((id, options) => logTask(id, Number(options.hours), options.content, options.date));
program.command('task:log-edit').argument('<id>').argument('<log-id>').requiredOption('--log-version <number>').requiredOption('--reason <text>').option('--hours <number>').option('--content <text>').option('--date <date>').action((id, logId, options) => correctTaskLog(id, logId, Number(options.logVersion), options.reason, { ...(options.hours === undefined ? {} : { hours: Number(options.hours) }), ...(options.content === undefined ? {} : { content: options.content }), ...(options.date === undefined ? {} : { workDate: options.date }) }));
program.command('task:log-withdraw').argument('<id>').argument('<log-id>').requiredOption('--log-version <number>').requiredOption('--reason <text>').action((id, logId, options) => correctTaskLog(id, logId, Number(options.logVersion), options.reason, {}, true));
const collectOption = (value: string, previous: string[] = []) => [...previous, value];
program.command('task:report').argument('<id>').requiredOption('--task-version <number>')
  .option('--summary <text>', 'Report summary (or provide summary in --file)')
  .option('--file <path>', 'Structured JSON report including criterionResults')
  .option('--changed-file <path>', 'Changed file', collectOption)
  .option('--test <value>', 'Test as command=result; actual result required', collectOption)
  .option('--commit <sha>').option('--outcome <outcome>', 'success, failed or blocked')
  .option('--git-base <sha>', 'Collect committed filenames and HEAD since a task-scoped local Git base')
  .option('--evidence <url>', 'Evidence URL', collectOption)
  .option('--risk <text>', 'Execution risk', collectOption)
  .option('--remaining-issue <text>', 'Remaining issue', collectOption)
  .action((id, options) => {
    const file = options.file ? readReportFile(options.file) : undefined;
    const report = buildReportOptions({ ...options, report: file?.options });
    if (options.gitBase) {
      const collected = collectGitReport(process.cwd(), options.gitBase, report.changedFiles);
      for (const warning of collected.warnings) console.warn(warning);
      report.changedFiles = [...new Set([...(report.changedFiles ?? []), ...collected.changedFiles])];
      report.commit ??= collected.commit;
    }
    return reportTask(id, Number(options.taskVersion), options.summary ?? file?.summary ?? '', report);
  });
program.command('task:plan').argument('<id>').requiredOption('--task-version <number>').requiredOption('--file <path>', 'Markdown execution plan')
  .action((id, options) => uploadTaskPlan(id, Number(options.taskVersion), readFileSync(options.file, 'utf8')));
program.command('task:progress').argument('<id>').requiredOption('--task-version <number>').requiredOption('--progress <number>').requiredOption('--stage <stage>', 'analysis, implementation, testing, blocked or ready_for_review').requiredOption('--summary <text>')
  .action((id, options) => updateTaskProgress(id, Number(options.taskVersion), Number(options.progress), options.stage, options.summary));
program.command('task:accept').argument('<id>').requiredOption('--task-version <number>').requiredOption('--decision <decision>', 'approved or rejected').option('--comment <text>').action((id, options) => acceptTask(id, Number(options.taskVersion), options.decision, options.comment));
program.command('check').action(() => checkWithStatus(process.cwd(), statusDependencies(cliVersion, { loadSession, createClient: (server, session) => new ApiClient(server, session), loadProjectConfig })));

async function offerLogin(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const abortController = new AbortController();
  const abortPrompt = () => abortController.abort();
  prompt.once('close', abortPrompt);
  try {
    return await chooseLogin(() => prompt.question('未登录或登录已过期。\n[1] 现在登录  [2] 取消\n请选择: ', { signal: abortController.signal }));
  } finally {
    prompt.off('close', abortPrompt);
    prompt.close();
  }
}

async function main(): Promise<void> {
  try {
    await program.parseAsync(normalizeTaskVersionOption(process.argv));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError && !startLoginAttempted && process.stdin.isTTY && process.stderr.isTTY) {
      if (await offerLogin()) {
        try {
          await login(error.server ?? 'https://vibeplan.szxinjin.cn');
          console.log('登录成功，请重新运行原命令。');
          return;
        } catch (loginError) {
          console.error(cliErrorMessage(loginError));
          process.exitCode = 1;
          return;
        }
      }
    }
    console.error(cliErrorMessage(error));
    process.exitCode = 1;
  }
}

await main();
