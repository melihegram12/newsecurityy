export async function withSingleFlight(lockRef, key, task) {
  const normalizedKey = String(key || 'default');
  if (!lockRef.current) {
    lockRef.current = new Set();
  }

  if (lockRef.current.has(normalizedKey)) {
    return undefined;
  }

  lockRef.current.add(normalizedKey);
  try {
    return await task();
  } finally {
    lockRef.current.delete(normalizedKey);
  }
}
