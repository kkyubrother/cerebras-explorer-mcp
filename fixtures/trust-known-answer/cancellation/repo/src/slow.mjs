export async function slowOperation(signal) {
  if (signal.aborted) throw signal.reason;
  return 'not-started';
}
