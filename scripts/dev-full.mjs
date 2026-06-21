import { spawn } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const shellCommand = isWindows ? 'cmd.exe' : '/bin/sh';
const shellArgs = isWindows ? ['/d', '/s', '/c'] : ['-lc'];

const children = [];
let shuttingDown = false;

function startProcess(name, commandText) {
  const child = spawn(shellCommand, [...shellArgs, commandText], {
    stdio: 'inherit',
  });

  children.push(child);

  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      console.log(`[${name}] stopped by signal ${signal}`);
      shutdown(0);
      return;
    }

    if (code !== 0 && code !== null) {
      console.log(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting Era Bot backend and frontend...');

startProcess('backend', 'python assistant_backend_api.py');
startProcess('frontend', 'npm run dev');
