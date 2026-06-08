const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createJsonLogger({
  level = "info",
  output = process.stderr,
  now = () => new Date().toISOString(),
} = {}) {
  const minLevel = LEVELS[level] ?? LEVELS.info;

  const write = (entryLevel, event, fields = {}) => {
    if ((LEVELS[entryLevel] ?? LEVELS.info) < minLevel) {
      return;
    }

    output.write(
      `${JSON.stringify({
        timestamp: now(),
        level: entryLevel,
        event,
        ...fields,
      })}\n`,
    );
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
