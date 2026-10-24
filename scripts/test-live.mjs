// Runs the live tests against the sandbox project with the GitHub CLI's credentials, passed to
// vitest through the environment only (nothing is written to disk).
//
//   npm run test:live
import { execFileSync, spawnSync } from 'node:child_process';

const credential = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.live.config.mts'], {
  stdio: 'inherit',
  env: { ...process.env, GHP_LIVE_TOKEN: credential },
});
process.exit(result.status ?? 1);
