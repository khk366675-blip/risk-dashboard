const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Next may normalize request.url to its bind hostname. Validate the browser's
 * actual Host instead, without trusting forwarded hosts or allowing cross-origin writes. */
export function isLocalDashboardRequest(
  request: Request,
  write = false,
  deployed = Boolean(process.env.VERCEL),
): boolean {
  if (deployed || request.headers.get('sec-fetch-site') === 'cross-site')
    return false;
  try {
    const url = new URL(request.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !loopbackHosts.has(url.hostname)
    )
      return false;
    const host = request.headers.get('host') ?? url.host;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host))
      return false;
    const browser = new URL(`${url.protocol}//${host}`);
    if (browser.port !== url.port) return false;
    return !write || request.headers.get('origin') === browser.origin;
  } catch {
    return false;
  }
}
