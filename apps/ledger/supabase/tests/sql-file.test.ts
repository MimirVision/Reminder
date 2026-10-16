import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildLedgerSql } from '../build.mjs';

it('ledger.sql matches the migrations (run npm run build:sql after changing them)', () => {
  expect(readFileSync(new URL('../ledger.sql', import.meta.url), 'utf8')).toBe(buildLedgerSql());
});

it('ledger.sql only creates ledger_* objects in the shared project', () => {
  const sql = buildLedgerSql();
  const created = [...sql.matchAll(/create (?:or replace )?(?:table|function|index|unique index|policy|trigger)(?: if not exists)? (?:public\.)?(\w+)/gi)].map((m) => m[1]);
  expect(created.length).toBeGreaterThan(20);
  expect(created.filter((n) => !n.startsWith('ledger_'))).toEqual([]);
  expect(sql).not.toMatch(/references auth\.users/i);
  expect(sql).not.toMatch(/(alter|drop) table (if exists )?public\.(?!ledger_)/i);
});
