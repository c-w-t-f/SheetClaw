const SCHEMA_VERSION = 1;

// Arrays can't be spread-merged with {_v} — we box them under _arr instead.
type Envelope = { _v: number; _arr?: unknown[] } & Record<string, unknown>;

function pack(value: unknown): Envelope {
  if (Array.isArray(value)) return { _v: SCHEMA_VERSION, _arr: value };
  return { ...(value as Record<string, unknown>), _v: SCHEMA_VERSION };
}

function unpack<T>(env: Envelope): T {
  if ('_arr' in env) return env._arr as T;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _v, ...rest } = env;
  return rest as T;
}

export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const env = JSON.parse(raw) as Envelope;
      if (env._v !== SCHEMA_VERSION) return null;
      return unpack<T>(env);
    } catch {
      return null;
    }
  },

  put<T>(key: string, value: T): void {
    const serialized = JSON.stringify(pack(value));
    try {
      localStorage.setItem(key, serialized);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        // Evict oldest usage day buckets then retry once
        evictOldestUsageBucket();
        try {
          localStorage.setItem(key, serialized);
        } catch {
          window.dispatchEvent(new CustomEvent('xl:quota-warning', { detail: { key } }));
        }
      }
    }
  },

  remove(key: string): void {
    localStorage.removeItem(key);
  },
};

function evictOldestUsageBucket(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('xl.usage.day.')) keys.push(k);
  }
  keys.sort(); // ISO dates sort lexicographically
  if (keys.length > 0) localStorage.removeItem(keys[0]);
}
