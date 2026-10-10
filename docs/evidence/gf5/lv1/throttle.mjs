// Same measuring run; Chromium's own CPU throttle, not synthetic feature duplication.
process.env.LV1_CPU_RATE = '4';
await import('./measure.mjs');
