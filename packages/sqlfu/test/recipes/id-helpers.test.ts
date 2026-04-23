import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import {expect, test} from 'vitest';

const recipesDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'recipes', 'id-helpers');

test('nanoid recipe generates 21-char ids from the url-safe alphabet', () => {
  using fixture = loadRecipe('nanoid.sql');
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  const ids = generate(fixture, 'select id from sqlfu_nanoid', 1000);

  expect(ids).toHaveLength(1000);
  for (const id of ids) {
    expect(id).toHaveLength(21);
    expect(id).toMatch(/^[\w-]{21}$/);
    for (const c of id) {
      expect(alphabet).toContain(c);
    }
  }
  // entropy check - 1000 unique ids
  expect(new Set(ids).size).toBe(1000);
});

test('ulid recipe generates 26-char crockford-base32 ids that sort by time', () => {
  using fixture = loadRecipe('ulid.sql');
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ids = generate(fixture, 'select id from sqlfu_ulid', 1000);

  expect(ids).toHaveLength(1000);
  for (const id of ids) {
    expect(id).toHaveLength(26);
    for (const c of id) {
      expect(alphabet).toContain(c);
    }
  }
  expect(new Set(ids).size).toBe(1000);

  // Time-prefix sort: two ulids generated in the same transaction should have
  // equal time prefix (first 10 chars), or a monotonically-later one.
  const prefixes = ids.map((id) => id.slice(0, 10));
  const sorted = [...prefixes].sort();
  expect(prefixes).toEqual(sorted);
});

test('ksuid recipe generates 32-char sqlite-friendly ksuid ids that sort by time', () => {
  // Canonical KSUID is 27-char base62. Base62 in pure sqlite SQL is awkward
  // (160-bit divmod), so this recipe encodes the same 20-byte payload
  // (4 time + 16 random) in Crockford base32 — 32 chars — and documents the
  // deviation from the canonical spec. Same sort behavior, different alphabet.
  using fixture = loadRecipe('ksuid.sql');
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ids = generate(fixture, 'select id from sqlfu_ksuid', 500);

  expect(ids).toHaveLength(500);
  for (const id of ids) {
    expect(id).toHaveLength(32);
    for (const c of id) expect(alphabet).toContain(c);
  }
  expect(new Set(ids).size).toBe(500);

  // First 6 base32 chars = 30 time bits (out of 32). Within a single run the
  // full 32-bit second is constant, so the first 6 chars are identical —
  // which sorts monotonically trivially. The 7th char mixes the remaining
  // 2 time bits with 3 entropy bits, so it's not monotonic within a second.
  const prefixes = ids.map((id) => id.slice(0, 6));
  const sorted = [...prefixes].sort();
  expect(prefixes).toEqual(sorted);
});

test('cuid2-shaped recipe generates 24-char ids starting with a letter', () => {
  using fixture = loadRecipe('cuid2.sql');
  const ids = generate(fixture, 'select id from sqlfu_cuid2', 1000);

  expect(ids).toHaveLength(1000);
  for (const id of ids) {
    expect(id).toHaveLength(24);
    expect(id).toMatch(/^[a-z][a-z\d]{23}$/);
  }
  expect(new Set(ids).size).toBe(1000);
});

test('every recipe file loads as a single CREATE statement block with a recognizable header', () => {
  const files = fs.readdirSync(recipesDir).filter((f) => f.endsWith('.sql'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const contents = fs.readFileSync(path.join(recipesDir, file), 'utf8');
    // Header block explains what this generator is and cites upstream.
    expect(contents).toMatch(/^--/);
    // Recipes install as CREATE statements so they live in definitions.sql.
    expect(contents).toMatch(/create /i);
  }
});

function loadRecipe(filename: string) {
  const db = new BetterSqlite3(':memory:');
  const sql = fs.readFileSync(path.join(recipesDir, filename), 'utf8');
  db.exec(sql);
  return {
    db,
    [Symbol.dispose]() {
      db.close();
    },
  };
}

function generate(fixture: {db: InstanceType<typeof BetterSqlite3>}, query: string, count: number): string[] {
  const stmt = fixture.db.prepare<{id: string}>(query);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = stmt.all();
    ids.push(row.id);
  }
  return ids;
}
