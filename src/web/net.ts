import { ToolNetworkError, ToolValidationError } from '../workbook/executor';

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_BODY_BYTES = 1_000_000;

const ALLOWED_PORTS = new Set(['', '80', '443', '8080']);

export interface FetchResponse {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  bytesFetched: number;
  text: string;
}

export function validatePublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ToolValidationError('URL must be an absolute http(s) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolValidationError('URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new ToolValidationError('URL must not contain embedded credentials.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new ToolValidationError('URL port is not allowed. Use 80, 443, or 8080.');
  }

  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ToolValidationError('URL host must be public, not localhost or local network.');
  }
  if (isBlockedIp(host)) {
    throw new ToolValidationError('URL host must be public, not private, loopback, or link-local.');
  }

  return url;
}

export async function fetchTextWithGuards(
  urlValue: string,
  opts: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
): Promise<FetchResponse> {
  const original = validatePublicHttpUrl(urlValue);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const abortFromParent = () => controller.abort();
  opts.signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    const response = await fetchImpl(original.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    const finalUrl = response.url || original.toString();
    validatePublicHttpUrl(finalUrl);

    const bytes = await readResponseBytes(response, maxBytes);
    return {
      url: original.toString(),
      finalUrl,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') ?? '',
      bytesFetched: bytes.byteLength,
      text: new TextDecoder().decode(bytes),
    };
  } catch (e) {
    if (e instanceof ToolValidationError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolNetworkError(`Network request failed or was blocked by CORS; this host cannot be fetched from the add-in. ${message}`);
  } finally {
    globalThis.clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', abortFromParent);
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new ToolNetworkError(`Response body exceeded ${maxBytes} bytes.`);
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new ToolNetworkError(`Response body exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isBlockedIp(host: string): boolean {
  return isBlockedIpv4(host) || isBlockedIpv6(host);
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map(p => Number(p));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}
