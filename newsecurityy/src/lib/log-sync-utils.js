export const getLogBindingId = (log = {}) => {
  const createdAt = log?.created_at ? String(log.created_at) : '';
  if (createdAt) return createdAt;
  const id = log?.id;
  return id === undefined || id === null || id === '' ? '' : String(id);
};

export const resolveOfflineSyncAction = (item = {}) => {
  const action = String(item?.action || 'INSERT').toUpperCase();
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const matchValue = item?.localId || data?.created_at || item?.id || null;

  if (action === 'INSERT') {
    return {
      action,
      matchField: matchValue ? 'created_at' : null,
      matchValue,
      payload: { ...data },
    };
  }

  if (action === 'UPDATE' || action === 'EXIT') {
    const payload = { ...data };
    delete payload.created_at;

    return {
      action,
      matchField: item?.localId || data?.created_at ? 'created_at' : (item?.id ? 'id' : null),
      matchValue,
      payload,
    };
  }

  if (action === 'DELETE') {
    return {
      action,
      matchField: item?.localId || data?.created_at ? 'created_at' : (item?.id ? 'id' : null),
      matchValue,
      payload: null,
    };
  }

  return {
    action,
    matchField: null,
    matchValue: null,
    payload: data,
  };
};
