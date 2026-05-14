const isMissingColumnError = (error, column) => {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message.includes('column')) return false;

  const escaped = String(column || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`['"\`]${escaped}['"\`]`).test(message)) return true;
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`).test(message);
};

export const dropUnsupportedSupabaseColumns = (payload = {}, error) => {
  const nextPayload = { ...payload };
  const keys = Object.keys(nextPayload);
  const missingColumns = keys.filter((column) => isMissingColumnError(error, column));

  if (missingColumns.length === 0) return null;

  missingColumns.forEach((column) => {
    delete nextPayload[column];
  });

  return nextPayload;
};

export async function executeWithSupabaseColumnFallback(execute, payload = {}) {
  let workingPayload = { ...(payload || {}) };

  while (true) {
    const response = await execute(workingPayload);
    const error = response?.error || null;

    if (!error) {
      return { ...response, payload: workingPayload };
    }

    const nextPayload = dropUnsupportedSupabaseColumns(workingPayload, error);
    if (!nextPayload) {
      return { ...response, payload: workingPayload };
    }

    if (Object.keys(nextPayload).length === 0) {
      return { data: null, error: null, skipped: true, payload: nextPayload };
    }

    workingPayload = nextPayload;
  }
}
