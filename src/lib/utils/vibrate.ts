const supported = typeof navigator !== "undefined" && "vibrate" in navigator;

const light = () => {
  if (!supported) return;
  navigator.vibrate(20);
};

const medium = () => {
  if (!supported) return;
  navigator.vibrate(30);
};

const heavy = () => {
  if (!supported) return;
  navigator.vibrate(40);
};

const success = () => {
  if (!supported) return;
  navigator.vibrate([35, 60, 45]);
};

const info = () => {
  heavy();
};

const warning = () => {
  if (!supported) return;
  navigator.vibrate([45, 100, 45]);
};

const error = () => {
  if (!supported) return;
  navigator.vibrate([45, 40, 45, 40, 45]);
};

const custom = (pattern: number | number[]) => {
  if (!supported) return;
  navigator.vibrate(pattern);
};

export default {
  success,
  info,
  warning,
  error,
  light,
  medium,
  heavy,
  custom,
};
