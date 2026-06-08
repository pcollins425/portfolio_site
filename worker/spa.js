/**
 * SPA shell for client routes under dashboard paths when no static file matches.
 * Kept in sync with vite.config.ts base paths.
 */
const DASHBOARD_PREFIX = "/dashboardtestv1";
const DGS_DASHBOARD_PREFIX = "/dgsappv1/dashboard";

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    for (const prefix of [DASHBOARD_PREFIX, DGS_DASHBOARD_PREFIX]) {
      const isDashboardBoot =
        pathname === prefix ||
        (pathname.startsWith(`${prefix}/`) &&
          !pathname.startsWith(`${prefix}/assets/`) &&
          !pathname.endsWith(".html"));

      if (isDashboardBoot) {
        url.pathname = `${prefix}/index.html`;
        return env.ASSETS.fetch(new Request(url.toString(), request));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
