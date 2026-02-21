/**
 * Promise-based concurrency limiter — runs at most `concurrency` tasks in parallel,
 * queuing the rest. Returns a `limit` function that wraps async work.
 *
 * Usage:
 *   const limit = createLimiter(3);
 *   const results = await Promise.all(items.map(item => limit(() => fetch(item))));
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    while (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
