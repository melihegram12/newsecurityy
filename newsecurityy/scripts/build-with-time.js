const { spawnSync } = require('child_process');

process.env.REACT_APP_BUILD_TIME = new Date().toISOString();
process.env.VITE_BUILD_TIME = process.env.REACT_APP_BUILD_TIME;

const result = spawnSync('vite', ['build'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
