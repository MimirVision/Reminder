// Cloudflare Pages Function: /calendar.ics (see api/remind.js).
import { handle } from '../netlify/functions/remind.mjs';

export const onRequest = (context) => handle(context.request, (name) => context.env[name]);
