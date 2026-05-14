const viteEnv = import.meta.env || {};
const existingProcess = typeof globalThis.process === 'object' && globalThis.process
  ? globalThis.process
  : {};
const existingEnv = typeof existingProcess.env === 'object' && existingProcess.env
  ? existingProcess.env
  : {};

const env = {
  ...viteEnv,
  ...existingEnv,
};

if (!env.REACT_APP_BUILD_TIME && env.VITE_BUILD_TIME) {
  env.REACT_APP_BUILD_TIME = env.VITE_BUILD_TIME;
}

if (!env.NODE_ENV) {
  env.NODE_ENV = viteEnv.PROD ? 'production' : 'development';
}

globalThis.process = {
  ...existingProcess,
  env,
};
