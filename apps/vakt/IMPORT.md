# Vakt: importing the roster from GAT

*Vakter → Importer fra GAT* reads a photo, screenshot or PDF of the roster and shows her shifts and days off to check
before anything is saved. Codes without times on the page (D, A, N …) are explained once and remembered
(Oppsett keeps them with the profile); codes that come with times are learnt automatically. Shifts she already has are
never added twice.

The reading is done by the edge function `vakt-import` with Claude (Anthropic API). The image is sent to the model to be
read and is not stored. Each person can import 20 times a day (counted in `vakt_ai_usage`).

## One-time setup

1. **Database.** Run `apps/vakt/supabase/vakt.sql` again (version 4 adds the daily count).
2. **The key.** Supabase → Edge Functions → Secrets: `ANTHROPIC_API_KEY`. If Home Memory's photo reading already works,
   it is there and Vakt uses the same one. Optional: `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
3. **The function.** Edge Functions → Deploy a new function → Via Editor, name it `vakt-import`, paste the whole of
   `apps/vakt/supabase/functions/vakt-import/index.ts`, Deploy. Leave "Verify JWT" on.

Until the key and the function are there, the import sheet explains that it isn't switched on yet.

## Tips for good results

- A screenshot of the month in GAT works best; a photo of a printout should be taken straight on, in good light.
- With a department roster, enter her name as it stands in GAT ("Etternavn, Fornavn"), or crop to her own row.
