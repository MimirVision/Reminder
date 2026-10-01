// Cloudflare Worker entry: serves the reminder links (/api/remind, /calendar.ics) and hands everything else to the static app.
import { handle } from '../netlify/functions/remind.mjs';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/remind' || pathname === '/calendar.ics') return handle(request, (name) => env[name]);
    return env.ASSETS.fetch(request);
  },
};
