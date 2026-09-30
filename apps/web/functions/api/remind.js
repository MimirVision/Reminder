// Cloudflare Pages Function: the same reminder links as the Netlify function, for hosting on Cloudflare Pages (free).
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as variables on the Pages project (they are used here at run time too).
import { handle } from '../../netlify/functions/remind.mjs';

export const onRequest = (context) => handle(context.request, (name) => context.env[name]);
