export type HttpObservation = {
  requestedUrl: string;
  status: number;
  location?: string;
  server?: string;
  cfMitigated?: string;
  cfRay?: string;
  retryAfter?: string;
  wwwAuthenticate?: string;
};

export type ProbeOptions = {
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
};

export class HttpProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpProbeError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

// Version-free on purpose: the HTTP layer stays decoupled from the package
// version. A caller wanting "AgentProof/<version>" passes it via options.headers.
const DEFAULT_USER_AGENT = 'AgentProof';

function toHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpProbeError(`invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpProbeError(`unsupported protocol: ${parsed.protocol}`);
  }
  return parsed;
}

function buildHeaders(overrides: Readonly<Record<string, string>>): Headers {
  const headers = new Headers({ 'user-agent': DEFAULT_USER_AGENT });
  for (const [name, value] of Object.entries(overrides)) {
    headers.set(name, value);
  }
  return headers;
}

async function discardBody(response: Response): Promise<void> {
  if (response.body === null) {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Discarding; a cancel failure is not interesting.
  }
}

// One controlled GET. Redirects are not followed and the body is never read;
// network failures throw HttpProbeError rather than becoming a fake status.
export async function probeHttp(
  url: string,
  options?: ProbeOptions,
): Promise<HttpObservation> {
  const target = toHttpUrl(url);
  const headers = buildHeaders(options?.headers ?? {});
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HttpProbeError(`request to ${url} failed: ${detail}`);
  }

  await discardBody(response);

  const field = (name: string): string | undefined =>
    response.headers.get(name) ?? undefined;

  const location = field('location');
  const server = field('server');
  const cfMitigated = field('cf-mitigated');
  const cfRay = field('cf-ray');
  const retryAfter = field('retry-after');
  const wwwAuthenticate = field('www-authenticate');

  return {
    requestedUrl: url,
    status: response.status,
    ...(location !== undefined ? { location } : {}),
    ...(server !== undefined ? { server } : {}),
    ...(cfMitigated !== undefined ? { cfMitigated } : {}),
    ...(cfRay !== undefined ? { cfRay } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(wwwAuthenticate !== undefined ? { wwwAuthenticate } : {}),
  };
}
