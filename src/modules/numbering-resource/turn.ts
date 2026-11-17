/**
 * One PSTN catalog request at a time for a numbering walk and the range snapshot.
 * The interactive resource page does not use this queue.
 */

let chain: Promise<unknown> = Promise.resolve();

export function pstnTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
