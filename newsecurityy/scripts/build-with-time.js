const { spawnSync } = require('child_process');

process.env.REACT_APP_BUILD_TIME = new Date().toISOString();

const result = spawnSync('react-scripts', ['build'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
