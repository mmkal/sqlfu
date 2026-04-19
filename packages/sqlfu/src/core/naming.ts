/**
 * Inspired by github.com/mmkal/pgkit/tree/main/src/pgkit/packages/client/src/naming.ts
 *
 * Modifications for sqlfu:
 * - focused on migration SQL naming rather than general query naming
 * - keeps only a short slug from the first statement
 * - falls back to `migration` instead of hashing
 */

import type {SqlQuery} from './types.js';
import {normalizeSqlForHash, shortHash} from './util.js';

const tokenize = (sql: string): string[] => {
  const tokens: string[] = [];
  let index = 0;

  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index += 1;
      continue;
    }

    if (sql[index] === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (sql[index] === '/' && sql[index + 1] === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (sql[index] === '"') {
      index += 1;
      let identifier = '';
      while (index < sql.length && sql[index] !== '"') {
        identifier += sql[index];
        index += 1;
      }
      index += 1;
      tokens.push(identifier);
      continue;
    }

    if (sql[index] === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }

        if (sql[index] === "'") {
          index += 1;
          break;
        }

        index += 1;
      }
      continue;
    }

    if ('();,=<>!+-*/.'.includes(sql[index])) {
      tokens.push(sql[index]);
      index += 1;
      continue;
    }

    if (/[\w$]/.test(sql[index])) {
      let word = '';
      while (index < sql.length && /[\w$]/.test(sql[index])) {
        word += sql[index];
        index += 1;
      }
      tokens.push(word);
      continue;
    }

    index += 1;
  }

  return tokens;
};

export function migrationNickname(sql: string): string {
  const tokens = tokenize(sql);
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();

    if (token === ';') {
      break;
    }

    const pushNextIdentifier = () => {
      const candidate = tokens[index + 1];
      if (!candidate) {
        return;
      }

      if (/^[;,()=<>!+\-*/.]+$/.test(candidate)) {
        return;
      }

      parts.push(candidate.toLowerCase());
      index += 1;
    };

    if ((lower === 'create' || lower === 'alter' || lower === 'drop') && tokens[index + 1]) {
      const next = tokens[index + 1]!.toLowerCase();
      if (next === 'table' || next === 'index' || next === 'view' || next === 'trigger') {
        parts.push(`${lower}_${next}`);
        index += 1;
        pushNextIdentifier();
        continue;
      }
    }

    if (lower === 'add' && tokens[index + 1]?.toLowerCase() === 'column') {
      parts.push('add_column');
      index += 1;
      pushNextIdentifier();
      continue;
    }

    if (lower === 'rename' && tokens[index + 1]?.toLowerCase() === 'to') {
      parts.push('rename_to');
      index += 1;
      pushNextIdentifier();
      continue;
    }

    if (lower === 'update' || lower === 'into' || lower === 'from') {
      parts.push(lower);
      pushNextIdentifier();
      continue;
    }
  }

  const slug = parts
    .join('_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || 'migration';
}

export function queryNickname(sql: string): string {
  const tokens = tokenize(sql);
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();

    if (token === ';') {
      break;
    }

    const nextIdentifier = () => {
      for (let offset = 1; offset <= 2; offset += 1) {
        const candidate = tokens[index + offset];
        if (!candidate) {
          return undefined;
        }
        if (/^[;,()=<>!+\-*/.]+$/.test(candidate)) {
          continue;
        }
        return candidate.toLowerCase();
      }
      return undefined;
    };

    if (lower === 'select') {
      const fromIndex = tokens.slice(index + 1).findIndex((candidate) => candidate.toLowerCase() === 'from');
      if (fromIndex !== -1) {
        index += fromIndex + 1;
        const relation = nextIdentifier();
        if (relation) {
          parts.push('list', relation);
          break;
        }
      }
    }

    if (lower === 'insert' && tokens[index + 1]?.toLowerCase() === 'into') {
      index += 1;
      parts.push('insert', nextIdentifier() ?? 'query');
      break;
    }

    if (lower === 'update') {
      parts.push('update', nextIdentifier() ?? 'query');
      break;
    }

    if (lower === 'delete') {
      const fromIndex = tokens.slice(index + 1).findIndex((candidate) => candidate.toLowerCase() === 'from');
      if (fromIndex !== -1) {
        index += fromIndex + 1;
      }
      parts.push('delete', nextIdentifier() ?? 'query');
      break;
    }
  }

  const slug = parts
    .join('-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'query';
}

/** one hundred positive adjectives, comma-separated, which are all different from each other */
export const adjectives =
  'admirable,adored,affable,agreeable,amazing,amiable,angelic,appealing,astonishing,astute,authentic,awesome,beauteous,beloved,blissful,bold,brave,bright,brilliant,bubbly,calm,capable,celebrated,charming,cheerful,classy,clever,compassionate,confident,considerate,courageous,creative,credible,dazzling,dear,delightful,dependable,devoted,dynamic,eager,earnest,easygoing,elegant,enchanting,encouraging,energetic,engaging,excellent,exceptional,fabulous,fair,faithful,fantastic,fine,friendly,funny,generous,gentle,genuine,gifted,glad,glorious,goodhearted,graceful,gracious,great,happy,harmonious,helpful,honest,hopeful,imaginative,impressive,incredible,insightful,inspiring,intelligent,joyful,kind,lively,lovable,lovely,loyal,marvelous,neat,noble,optimistic,outstanding,peaceful,pleasant,polished,positive,radiant,remarkable,resilient,spectacular,splendid,stellar,terrific,thoughtful,vibrant,wonderful'.split(
    ',',
  );
export const animals =
  'aardvark,alligator,alpaca,antelope,armadillo,badger,bat,bear,beaver,bison,buffalo,butterfly,camel,cat,cheetah,chicken,chimpanzee,cobra,cougar,cow,coyote,crocodile,deer,dog,dolphin,donkey,duck,eagle,elephant,falcon,ferret,flamingo,fox,frog,gazelle,giraffe,goat,gorilla,hamster,hawk,hedgehog,hippopotamus,horse,hyena,iguana,jaguar,jellyfish,kangaroo,koala,leopard,lion,lizard,llama,lobster,lynx,meerkat,monkey,moose,mouse,octopus,otter,owl,panda,panther,parrot,peacock,pelican,penguin,pig,pigeon,polar bear,pony,porcupine,rabbit,raccoon,rat,raven,reindeer,rhinoceros,salmon,seal,shark,sheep,skunk,sloth,snail,snake,sparrow,spider,squid,squirrel,swan,tiger,toad,turkey,turtle,walrus,whale,wolf,wombat,zebra'.split(
    ',',
  );

export function generateRandomName(rng = Math.random) {
  return `${adjectives[Math.floor(rng() * adjectives.length)]} ${animals[Math.floor(rng() * animals.length)]}`;
}

/**
 * Span-name derivation for observability hooks. Named queries get their
 * author-given name verbatim; ad-hoc queries get a readable nickname plus a
 * stable short hash of the (normalized) parameterized SQL, so the same
 * ad-hoc call site buckets together across different parameter values.
 *
 * `client.raw()` is not uniquely identified — the raw SQL string has values
 * interpolated into it, so the hash becomes per-value. If you need named
 * observability on dynamic SQL, pass a `name` on the SqlQuery directly:
 * `client.run({ sql, args, name: 'my-query' })`.
 */
export function spanNameFor(query: SqlQuery): string {
  if (query.name) {
    return query.name;
  }
  const nickname = queryNickname(query.sql);
  const hash = shortHash(normalizeSqlForHash(query.sql));
  return `sql-${nickname}-${hash}`;
}
