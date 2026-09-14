const log = {
  error: console.error,
  warn: console.warn,
  info: console.log,
  trace: console.trace,
  debug: console.debug,
  time: key => {
    log.timingKeys[key] = true;
    log.timeStartedAt[key] = performance.now();
    console.time(key);
  },
  timeEnd: key => {
    if (!log.timingKeys[key]) {
      return;
    }
    log.timingKeys[key] = false;
    console.timeEnd(key);
  },
  // Store the timing keys to allow knowing whether or not to log events
  timingKeys: {
    // script time values are added during the index.html initial load,
    // before log (this file) is loaded, and the log
    // can't depend on the enums, so for this case recreate the string.
    // See TimingEnum for details
    scriptToView: true,
  },
  // console.time/timeEnd only print to the console — they never expose the
  // duration to code. Record when each timer started so consumers (e.g.
  // first_image_rendered analytics) can compute elapsed ms themselves.
  timeStartedAt: {},
};

export default log;
