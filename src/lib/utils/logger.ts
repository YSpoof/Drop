let _devMode = false;
export function setDevMode(enabled: boolean) {
  _devMode = enabled;
}

export const logger = {
  log: (...message: any[]) => {
    if (!_devMode) return;
    setTimeout(() => console.log(...message));
  },
  info: (...message: any[]) => {
    if (!_devMode) return;
    setTimeout(() => console.info(...message));
  },
  warn: (...message: any[]) => {
    if (!_devMode) return;
    setTimeout(() => console.warn(...message));
  },
  error: (...message: any[]) => {
    if (!_devMode) return;
    setTimeout(() => {
      console.error(...message);
    });
  },
};
