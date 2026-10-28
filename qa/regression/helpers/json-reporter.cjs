function serializeError(error) {
  if (!error) return undefined;
  return {
    message: error.message, code: error.code, stack: error.stack,
    actual: error.actual, expected: error.expected,
    cause: serializeError(error.cause),
  };
}

module.exports = async function* report(events) {
  for await (const event of events) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      yield JSON.stringify({
        event: event.type, name: event.data.name,
        file: event.data.file, line: event.data.line,
        error: serializeError(event.data.details?.error),
      }) + '\n';
    } else if (event.type === 'test:diagnostic') {
      yield JSON.stringify({ event: event.type, message: event.data.message }) + '\n';
    }
  }
};
