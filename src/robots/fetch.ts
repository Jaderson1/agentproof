export type RobotsObservation =
  | { kind: 'available'; url: string; status: number; body: string }
  | { kind: 'unavailable'; url: string; status?: number; reason: string };

export type FetchRobotsOptions = {
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
};

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ROBOTS_BYTES = 512 * 1024;
const DEFAULT_USER_AGENT = 'AgentProof';

function robotsUrlFor(target: string): string {
  const parsed = new URL(target);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  return new URL('/robots.txt', parsed.origin).toString();
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Discarding; a cancel failure is not interesting.
  }
}

// Reads the response text but stops once the byte cap is exceeded, returning
// null in that case so the caller can treat an oversized robots.txt as unknown.
async function readCappedText(
  response: Response,
  cap: number,
): Promise<string | null> {
  const body = response.body;
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  for (;;) {
    // Node types the fetch body stream as ReadableStream<any>; pin the chunk.
    const { done, value } = (await reader.read()) as {
      done: boolean;
      value: Uint8Array | undefined;
    };
    if (done) {
      break;
    }
    if (value !== undefined) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  }
  text += decoder.decode();
  return text;
}

// One controlled GET to <origin>/robots.txt. It never throws: any failure
// (bad target, network error, timeout, non-2xx, oversized body) becomes an
// 'unavailable' observation so a missing policy source cannot fail validation.
export async function fetchRobots(
  target: string,
  options?: FetchRobotsOptions,
): Promise<RobotsObservation> {
  let robotsUrl: string;
  try {
    robotsUrl = robotsUrlFor(target);
  } catch {
    return { kind: 'unavailable', url: target, reason: 'unsupported-target' };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = new Headers({ 'user-agent': DEFAULT_USER_AGENT });
  for (const [name, value] of Object.entries(options?.headers ?? {})) {
    headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(robotsUrl, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      kind: 'unavailable',
      url: robotsUrl,
      reason: timedOut ? 'timeout' : 'network-error',
    };
  }

  const status = response.status;
  if (status < 200 || status >= 300) {
    await discardBody(response);
    return {
      kind: 'unavailable',
      url: robotsUrl,
      status,
      reason: status === 404 || status === 410 ? 'not-found' : 'http-status',
    };
  }

  const body = await readCappedText(response, MAX_ROBOTS_BYTES);
  if (body === null) {
    return { kind: 'unavailable', url: robotsUrl, status, reason: 'too-large' };
  }
  return { kind: 'available', url: robotsUrl, status, body };
}
