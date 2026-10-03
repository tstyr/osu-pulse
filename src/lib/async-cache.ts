/** Share an in-flight read, then retain its result briefly. Failed reads are never cached. */
export function cachedAsync<T>(read: () => Promise<T>, ttlMs: number) {
  let entry: { value: Promise<T>; expiresAt: number } | undefined;
  return () => {
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    const current = { value: Promise.resolve().then(read), expiresAt: Infinity };
    entry = current;
    void current.value.then(
      () => { current.expiresAt = Date.now() + ttlMs; },
      () => { if (entry === current) entry = undefined; },
    );
    return current.value;
  };
}
