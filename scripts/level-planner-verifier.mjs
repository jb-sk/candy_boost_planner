#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const rootDir = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

function parseArgs(argv) {
  const options = {
    timeoutMs: 120_000,
    oracleRuns: 10,
    oracleStart: 1,
    oracleModes: ['surplusFirst', 'surplusGateFirst', 'legacyImproved'],
    perfModes: ['surplusFirst', 'surplusGateFirst', 'legacyImproved'],
    skipOracle: false,
    skipPerf: false,
    outDir: path.join('_local', 'level-planner-verifier', timestamp),
  };
  for (const arg of argv) {
    const [key, rawValue] = arg.split('=', 2);
    const value = rawValue ?? '';
    if (key === '--timeout-ms') options.timeoutMs = Number(value);
    else if (key === '--oracle-runs') options.oracleRuns = Number(value);
    else if (key === '--oracle-start') options.oracleStart = Number(value);
    else if (key === '--oracle-modes') options.oracleModes = value.split(',').map(item => item.trim()).filter(Boolean);
    else if (key === '--perf-modes') options.perfModes = value.split(',').map(item => item.trim()).filter(Boolean);
    else if (key === '--out-dir') options.outDir = value;
    else if (key === '--skip-oracle') options.skipOracle = true;
    else if (key === '--skip-perf' || key === '--skip-probe') options.skipPerf = true;
    else if (key === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  options.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120_000;
  options.oracleRuns = Number.isFinite(options.oracleRuns) && options.oracleRuns > 0 ? options.oracleRuns : 10;
  options.oracleStart = Number.isFinite(options.oracleStart) && options.oracleStart > 0 ? options.oracleStart : 1;
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm run verify:level-planner -- [options]

Runs level-planner verification in isolated child processes.

Options:
  --timeout-ms=120000         Timeout per child process. Default: 120000
  --oracle-runs=10            Random full-plan oracle run count. Default: 10
  --oracle-start=1            Random full-plan oracle starting seed. Default: 1
  --oracle-modes=surplusFirst,surplusGateFirst,legacyImproved
                              Oracle modes. Default: all current modes
  --perf-modes=surplusFirst,surplusGateFirst,legacyImproved
                              Feasibility performance fixture modes. Default: all current modes
  --skip-oracle               Skip full-plan oracle test
  --skip-perf                 Skip feasibility performance fixture
  --skip-probe                Deprecated alias for --skip-perf
  --out-dir=_local/...        Output directory
`);
}

function vitestCommand() {
  return {
    command: process.execPath,
    args: [path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs')],
  };
}

function summarizeOutput(text) {
  const lines = text.split(/\r?\n/);
  const interesting = lines.filter(line =>
    line.includes('[level-planner-probe] result')
    || line.includes('Test Files')
    || line.includes('Tests')
    || line.includes('Duration')
    || line.includes('FAIL')
    || line.includes('FATAL ERROR')
    || line.includes('JavaScript heap out of memory')
    || line.includes('full-plan oracle exploded')
    || line.includes('AssertionError')
  );
  return interesting.slice(-40);
}

function parsePerfRows(text) {
  const rows = [];
  for (const match of text.matchAll(/\[level-planner-feasibility-perf\] result\s+(\{[^\r\n]+\})/g)) {
    try {
      rows.push(JSON.parse(match[1]));
    } catch {
      // The test output remains in the log and a missing parsed row fails below.
    }
  }
  return rows;
}

async function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('close', resolve);
      killer.on('error', resolve);
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function runCase({ name, env, timeoutMs, logPath }) {
  const started = performance.now();
  const childEnv = { ...process.env, ...env };
  const vitest = vitestCommand();
  const child = spawn(vitest.command, [
    ...vitest.args,
    'run',
    env.LEVEL_PLANNER_FEASIBILITY_PERF === '1'
      ? 'tests/unit/level-planner/feasibility-performance.test.ts'
      : 'tests/unit/level-planner/full-plan-oracle.test.ts',
    '--configLoader',
    'runner',
    '--reporter=dot',
  ], {
    cwd: rootDir,
    env: childEnv,
    windowsHide: true,
  });

  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    await killTree(child.pid);
  }, timeoutMs);

  const exit = await new Promise(resolve => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', error => resolve({ code: null, signal: null, error: String(error) }));
  });
  clearTimeout(timer);

  const durationMs = Math.round((performance.now() - started) * 10) / 10;
  await writeFile(logPath, output, 'utf8');
  const perfRows = parsePerfRows(output);
  const expectedPerfModes = (env.LEVEL_PLANNER_FEASIBILITY_PERF_MODES ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const parsedPerfModes = perfRows.map(row => row.mode);
  const perfParseValid = env.LEVEL_PLANNER_FEASIBILITY_PERF !== '1'
    || (expectedPerfModes.length === parsedPerfModes.length
      && expectedPerfModes.every(mode => parsedPerfModes.includes(mode)));
  const status = timedOut ? 'timeout' : exit.code === 0 && perfParseValid ? 'passed' : 'failed';
  return {
    name,
    status,
    durationMs,
    exitCode: exit.code,
    signal: exit.signal,
    logPath,
    perfRows,
    perfParseValid,
    summary: summarizeOutput(output),
  };
}

function tsvValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const results = [];

  if (!options.skipOracle) {
    const name = `oracle-random-runs-${options.oracleRuns}`;
    console.log(`[verifier] ${name}`);
    results.push(await runCase({
      name,
      timeoutMs: options.timeoutMs,
      logPath: path.join(options.outDir, `${name}.log`),
      env: {
        LEVEL_PLANNER_ORACLE_RANDOM_RUNS: String(options.oracleRuns),
        LEVEL_PLANNER_ORACLE_RANDOM_START: String(options.oracleStart),
        LEVEL_PLANNER_ORACLE_RANDOM_MODES: options.oracleModes.join(','),
      },
    }));
  }

  if (!options.skipPerf) {
    const name = 'feasibility-performance-fixture';
    console.log(`[verifier] ${name}`);
    results.push(await runCase({
      name,
      timeoutMs: options.timeoutMs,
      logPath: path.join(options.outDir, `${name}.log`),
      env: {
        LEVEL_PLANNER_FEASIBILITY_PERF: '1',
        LEVEL_PLANNER_FEASIBILITY_PERF_MODES: options.perfModes.join(','),
      },
    }));
  }

  const summaryJson = path.join(options.outDir, 'summary.json');
  const summaryTsv = path.join(options.outDir, 'summary.tsv');
  await writeFile(summaryJson, JSON.stringify({ options, results }, null, 2), 'utf8');
  await writeFile(summaryTsv, [
    'name\tstatus\tdurationMs\tmode\tfeasibilityMs\trowOptionCounts\ttypeBlockFrontierCounts\tglobalKeyCount\ttransitions\tlogPath',
    ...results.flatMap(result => {
      const rows = result.perfRows.length ? result.perfRows : [{}];
      return rows.map(row => [
        result.name,
        result.status,
        result.durationMs,
        row.mode,
        row.feasibilityMs,
        row.rowOptionCounts?.join(','),
        row.typeBlockFrontierCounts?.join(','),
        row.globalKeyCount,
        row.transitions,
        result.logPath,
      ].map(tsvValue).join('\t'));
    }),
    '',
  ].join('\n'), 'utf8');

  console.log(`\n[verifier] wrote ${summaryTsv}`);
  for (const result of results) {
    const suffix = result.perfRows.length
      ? ` modes=${result.perfRows.map(row => row.mode).join(',')}`
      : '';
    console.log(`[verifier] ${result.status.padEnd(7)} ${String(result.durationMs).padStart(8)}ms ${result.name}${suffix}`);
  }

  if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
}

await main();
