/** True inside the Neutralino shell. Token is missing for extra browsers (`tokenSecurity: one-time`). */
export const isNative = () =>
  typeof window !== "undefined" && !!(window.NL_TOKEN || sessionStorage.getItem("NL_TOKEN"));
