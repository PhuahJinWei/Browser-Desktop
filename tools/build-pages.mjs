/**
 * Builds exactly what GitHub Pages will serve, for local verification.
 *
 * Setting VITE_BASE inline on the command line is a trap on Windows: Git Bash rewrites a leading
 * `/tabula/` into a Windows path, producing a build whose every asset URL is wrong in a way that
 * only shows up as a MIME-type error in the browser. Setting it here removes the shell from the
 * equation entirely.
 *
 *   node tools/build-pages.mjs [--base /tabula/]
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const index = args.indexOf('--base');
const base = index >= 0 && args[index + 1] ? args[index + 1] : '/tabula/';

console.log(`Building with base ${base}`);
const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_BASE: base },
});
process.exit(result.status ?? 1);
