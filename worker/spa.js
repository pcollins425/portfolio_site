/**
 * SPA shell for client routes under /dashboardtestv1/ when no static file matches.
 * Kept in sync with `DASHBOARD_BASE` in frontend/vite.config.ts.
 */
const DASHBOARD_PREFIX = "/dashboardtestv1";

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    const isDashboardBoot =
      pathname === DASHBOARD_PREFIX ||
      (pathname.startsWith(`${DASHBOARD_PREFIX}/`) &&
        !pathname.startsWith(`${DASHBOARD_PREFIX}/assets/`) &&
        !pathname.endsWith(".html"));

    if (isDashboardBoot) {
      url.pathname = `${DASHBOARD_PREFIX}/index.html`;
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
