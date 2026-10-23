// A server action with some arguments fixed, created once per (action, arguments) and then reused.
//
// Why: a form using useActionState(action.bind(null, id)) makes a new bound action on every render.
// When a form is posted before the page's JavaScript has loaded, React's server render waits for
// the bound arguments of the action it is matching to settle, and retries; each retry made a new
// binding with a new, unsettled promise, so the server looped forever and ran out of memory. A
// reused binding settles once and the retry succeeds.

type AnyFn = (...args: never[]) => unknown;

const cache = new WeakMap<AnyFn, Map<string, AnyFn>>();
const MAX_PER_ACTION = 5000;

export function boundAction<B extends unknown[], R extends unknown[], T>(
  action: (...args: [...B, ...R]) => T,
  ...bound: B
): (...rest: R) => T {
  const key = JSON.stringify(bound);
  let byArgs = cache.get(action as unknown as AnyFn);
  if (!byArgs) {
    byArgs = new Map();
    cache.set(action as unknown as AnyFn, byArgs);
  }
  let fn = byArgs.get(key);
  if (!fn) {
    if (byArgs.size >= MAX_PER_ACTION) {
      const oldest = byArgs.keys().next().value;
      if (oldest !== undefined) byArgs.delete(oldest);
    }
    fn = (action as unknown as (...a: unknown[]) => T).bind(null, ...bound) as unknown as AnyFn;
    byArgs.set(key, fn);
  }
  return fn as unknown as (...rest: R) => T;
}
