// Cloudflare Worker entry: serves the reminder links (/api/remind, /calendar.ics), the big-attachment relay for Post (/api/post-upload) and
// hands everything else to the static app.
import { handle } from '../netlify/functions/remind.mjs';
import { relayUpload } from './upload-relay.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/remind' || pathname === '/calendar.ics') return handle(request, (name) => env[name]);
    if (pathname === '/api/post-upload') return relayUpload(request);
    return env.ASSETS.fetch(request);
  },
};
