/**
 * A link to a page on the marketing site (the legal pages, for now).
 *
 * The dashboard and the marketing site are on different hosts: live serves
 * app.bookaihub.com and bookaihub.com, staging serves app.artweel.fillforge.cloud
 * and artweel.fillforge.cloud. Taking the "app." off the dashboard's own host
 * gives the right site on either box, with no build setting to keep in step
 * with the server's PUBLIC_URL.
 *
 * In development the dashboard runs on Vite (port 5173) and the API serves the
 * marketing site on port 4000.
 */
export function marketingUrl(path: string): string {
  const { protocol, hostname, port } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:4000${path}`;
  }

  const host = hostname.startsWith('app.') ? hostname.slice(4) : hostname;
  return `${protocol}//${host}${port ? `:${port}` : ''}${path}`;
}
