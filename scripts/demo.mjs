// Runs `next dev` in demo mode (fake data). Works on Windows, macOS and Linux.
import { spawn } from 'child_process';

const child = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, BAMBU_DEMO: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
