const queues = new Map();

export const withKeyedLock = async (key, task) => {
  const lockKey = String(key);
  const previous = queues.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  queues.set(lockKey, current);

  try {
    return await current;
  } finally {
    if (queues.get(lockKey) === current) queues.delete(lockKey);
  }
};
