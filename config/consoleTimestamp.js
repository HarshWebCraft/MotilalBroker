"use strict";

// Prefix every server-side console message with the current India Standard Time.
// The guard keeps this safe if the module is required more than once.
if (!global.__motilalIstConsoleTimestampEnabled) {
  global.__motilalIstConsoleTimestampEnabled = true;

  const timestamp = () =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(", ", " ");

  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(`[IST ${timestamp()}]`, ...args);
  }
}
