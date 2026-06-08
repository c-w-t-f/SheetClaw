const SCHEMA_VERSION = 1;

type Versioned<T> = T & { _v: number };

function withVersion<T extends object>(value: T): Versioned<T> {
  return { ...value, _v: SCHEMA_VERSION };
}

function stripVersion<T>(value: Versioned<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _v, ...rest } = value;
  return rest as T;
}

export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Versioned<T>;
      if (parsed._v !== SCHEMA_VERSION) return null; // stale schema, discard
      return stripVersion(parsed);
    } catch {
      return null;
    }
  },

  put<T extends object>(key: string, value: T): void {
    const serialized = JSON.stringify(withVersion(value));
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
