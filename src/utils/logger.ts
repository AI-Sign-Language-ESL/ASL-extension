const DEBUG = true;
const PREFIX = '[TAFAHOM]';

export const logger = {
  info: (...args: unknown[]) => {
    if (DEBUG) console.log(PREFIX, ...args);
  },
  warn: (...args: unknown[]) => {
    if (DEBUG) console.warn(PREFIX, ...args);
  },
  error: (...args: unknown[]) => {
    console.error(PREFIX, ...args);
  },
};
