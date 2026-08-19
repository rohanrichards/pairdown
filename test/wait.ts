// A fixed setTimeout before asserting on cross-socket propagation races a
// wall-clock timer against real async work: a generous margin on a fast,
// idle machine can still be a false failure under load or a GC pause, with no
// defect behind it. Poll for the actual condition instead, bounded so a real
// break still fails the test rather than hanging it.
export async function waitFor(predicate: () => boolean, ms = 2000, step = 10): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${ms}ms`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}
