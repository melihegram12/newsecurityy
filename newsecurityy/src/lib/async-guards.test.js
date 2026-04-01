import { withSingleFlight } from './async-guards';

describe('async-guards', () => {
  test('withSingleFlight drops concurrent calls with the same key', async () => {
    const lockRef = { current: new Set() };
    const calls = [];

    const first = withSingleFlight(lockRef, 'entry-submit', async () => {
      calls.push('first');
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'ok';
    });

    const second = withSingleFlight(lockRef, 'entry-submit', async () => {
      calls.push('second');
      return 'should-not-run';
    });

    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBeUndefined();
    expect(calls).toEqual(['first']);
  });

  test('withSingleFlight releases the lock after completion', async () => {
    const lockRef = { current: new Set() };

    await withSingleFlight(lockRef, 'entry-submit', async () => 'first-pass');
    await expect(withSingleFlight(lockRef, 'entry-submit', async () => 'second-pass')).resolves.toBe('second-pass');
  });
});
