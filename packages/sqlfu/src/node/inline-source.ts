import fs from 'node:fs/promises';

import type {Migration} from '../migrations/index.js';

export type InlineSqlfuSource = {
  modulePath: string;
  sourceText: string;
  definitions: InlineSqlTemplate;
  migrations: InlineMigrationSource[];
  migrationsArray: {
    insertPosition: number;
  };
  queries: InlineQuerySource[];
};

export type InlineSqlTemplate = {
  sql: string;
  tagStart: number;
  templateStart: number;
};

export type InlineMigrationSource = {
  name: string;
  content: InlineSqlTemplate;
};

export type InlineQuerySource = {
  name: string;
  content: InlineSqlTemplate;
};

export async function readInlineSqlfuSource(modulePath: string): Promise<InlineSqlfuSource | null> {
  const sourceText = await fs.readFile(modulePath, 'utf8');
  return parseInlineSqlfuSource(modulePath, sourceText);
}

export function parseInlineSqlfuSource(modulePath: string, sourceText: string): InlineSqlfuSource | null {
  const inlineCall = findInlineSqlfuCall(sourceText, modulePath);
  if (!inlineCall) return null;

  const definitionStart = skipTrivia(sourceText, inlineCall.openParen + 1);
  if (sourceText[definitionStart] !== '{') {
    throw new Error(`inlineSqlfu(...) in ${modulePath} must be called with an object literal.`);
  }
  const definitionEnd = findMatchingDelimiter(sourceText, definitionStart, '{', '}');
  const afterDefinition = skipTrivia(sourceText, definitionEnd + 1);
  if (sourceText[afterDefinition] !== ')') {
    throw new Error(`inlineSqlfu(...) in ${modulePath} must contain exactly one object literal argument.`);
  }

  const definitionProperties = parseObjectProperties(sourceText, definitionStart, definitionEnd, modulePath);
  const definitions = readSqlProperty(definitionProperties, 'definitions', modulePath);
  const migrationsArray = readArrayProperty(definitionProperties, 'migrations', modulePath);
  const queriesObject = readObjectProperty(definitionProperties, 'queries', modulePath);

  return {
    modulePath,
    sourceText,
    definitions,
    migrations: readMigrationSources(sourceText, migrationsArray, modulePath),
    migrationsArray: {
      insertPosition: migrationsArray.end,
    },
    queries: readQuerySources(sourceText, queriesObject, modulePath),
  };
}

export async function writeInlineQueryTypes(
  modulePath: string,
  queryTypes: ReadonlyMap<string, string>,
): Promise<void> {
  const inline = await readRequiredInlineSqlfuSource(modulePath);
  const replacements = inline.queries.map((query) => {
    const queryType = queryTypes.get(query.name);
    if (!queryType) {
      throw new Error(`Missing generated inline query type for ${query.name}.`);
    }
    return {
      start: query.content.tagStart,
      end: query.content.templateStart,
      text: `sql<${queryType}>`,
    };
  });
  await fs.writeFile(modulePath, applyReplacements(inline.sourceText, replacements));
}

export async function appendInlineMigration(
  modulePath: string,
  migration: {
    name: string;
    content: string;
  },
): Promise<void> {
  const inline = await readRequiredInlineSqlfuSource(modulePath);
  const insertPosition = inline.migrationsArray.insertPosition;
  const beforeInsert = inline.sourceText.slice(0, insertPosition).trimEnd();
  const closingIndent = lineIndentAt(inline.sourceText, insertPosition);
  const elementIndent = `${closingIndent}  `;
  const prefix = inline.migrations.length === 0 ? '\n' : `${beforeInsert.endsWith(',') ? '' : ','}\n`;
  const insertion = `${prefix}${renderInlineMigrationObject(elementIndent, migration)}\n${closingIndent}`;
  await fs.writeFile(
    modulePath,
    `${beforeInsert}${insertion}${inline.sourceText.slice(insertPosition)}`,
  );
}

export function inlineMigrationsToMigrationFiles(inline: InlineSqlfuSource): Migration[] {
  return inline.migrations.map((migration) => ({
    path: `${migration.name}.sql`,
    content: migration.content.sql,
  }));
}

async function readRequiredInlineSqlfuSource(modulePath: string): Promise<InlineSqlfuSource> {
  const inline = await readInlineSqlfuSource(modulePath);
  if (!inline) {
    throw new Error(`No inlineSqlfu(...) call found in ${modulePath}.`);
  }
  return inline;
}

function findInlineSqlfuCall(sourceText: string, modulePath: string): {openParen: number} | null {
  const calls: {openParen: number}[] = [];
  forEachCodeIndex(sourceText, (index) => {
    if (!startsWithIdentifier(sourceText, index, 'inlineSqlfu')) return;
    const previous = sourceText[index - 1] || '';
    const next = sourceText[index + 'inlineSqlfu'.length] || '';
    if (isIdentifierPart(previous) || previous === '.' || isIdentifierPart(next)) return;
    const openParen = skipTrivia(sourceText, index + 'inlineSqlfu'.length);
    if (sourceText[openParen] === '(') {
      calls.push({openParen});
    }
  });
  if (calls.length > 1) {
    throw new Error(`${modulePath} contains more than one inlineSqlfu(...) call.`);
  }
  return calls[0] || null;
}

type SourceSpan = {
  start: number;
  end: number;
};

type PropertySpan = SourceSpan & {
  name: string;
};

function readSqlProperty(properties: PropertySpan[], name: string, modulePath: string): InlineSqlTemplate {
  return readSqlTemplate(sourceTextFor(properties), readProperty(properties, name, modulePath), `${modulePath} ${name}`);
}

function readArrayProperty(properties: PropertySpan[], name: string, modulePath: string): SourceSpan {
  const property = readProperty(properties, name, modulePath);
  const sourceText = sourceTextFor(properties);
  const start = skipTrivia(sourceText, property.start);
  if (sourceText[start] !== '[') {
    throw new Error(`inlineSqlfu(...) in ${modulePath} must provide "${name}" as an array literal.`);
  }
  return {start, end: findMatchingDelimiter(sourceText, start, '[', ']')};
}

function readObjectProperty(properties: PropertySpan[], name: string, modulePath: string): SourceSpan {
  const property = readProperty(properties, name, modulePath);
  const sourceText = sourceTextFor(properties);
  const start = skipTrivia(sourceText, property.start);
  if (sourceText[start] !== '{') {
    throw new Error(`inlineSqlfu(...) in ${modulePath} must provide "${name}" as an object literal.`);
  }
  return {start, end: findMatchingDelimiter(sourceText, start, '{', '}')};
}

function readProperty(properties: PropertySpan[], name: string, modulePath: string): PropertySpan {
  const property = properties.find((candidate) => candidate.name === name);
  if (!property) {
    throw new Error(`inlineSqlfu(...) in ${modulePath} must provide a "${name}" property assignment.`);
  }
  return property;
}

function readMigrationSources(sourceText: string, array: SourceSpan, modulePath: string): InlineMigrationSource[] {
  return parseArrayElements(sourceText, array).map((element, index) => {
    const objectStart = skipTrivia(sourceText, element.start);
    if (sourceText[objectStart] !== '{') {
      throw new Error(`inlineSqlfu(...) migration ${index} in ${modulePath} must be an object literal.`);
    }
    const objectEnd = findMatchingDelimiter(sourceText, objectStart, '{', '}');
    const properties = parseObjectProperties(sourceText, objectStart, objectEnd, modulePath);
    const name = readStringInitializer(sourceText, readProperty(properties, 'name', modulePath), `${modulePath} migration name`);
    const content = readSqlTemplate(sourceText, readProperty(properties, 'content', modulePath), `${modulePath} migration ${name}`);
    return {name, content};
  });
}

function readQuerySources(sourceText: string, object: SourceSpan, modulePath: string): InlineQuerySource[] {
  return parseObjectProperties(sourceText, object.start, object.end, modulePath).map((property) => {
    const name = property.name;
    const content = readSqlTemplate(sourceText, property, `${modulePath} query ${name}`);
    return {name, content};
  });
}

function readSqlTemplate(sourceText: string, span: SourceSpan, location: string): InlineSqlTemplate {
  const tagStart = skipTrivia(sourceText, span.start);
  if (!startsWithIdentifier(sourceText, tagStart, 'sql')) {
    throw new Error(`${location} must use the sql tag.`);
  }
  let cursor = skipTrivia(sourceText, tagStart + 'sql'.length);
  if (sourceText[cursor] === '<') {
    cursor = skipTrivia(sourceText, findMatchingAngle(sourceText, cursor) + 1);
  }
  if (sourceText[cursor] !== '`') {
    throw new Error(`${location} must be a sql\`...\` tagged template.`);
  }
  const templateStart = cursor;
  const templateEnd = findTemplateEnd(sourceText, templateStart, location);
  const afterTemplate = skipTrivia(sourceText, templateEnd + 1);
  if (afterTemplate < span.end) {
    throw new Error(`${location} must be a plain sql\`...\` tagged template.`);
  }
  return {
    sql: sourceText.slice(templateStart + 1, templateEnd).trim(),
    tagStart,
    templateStart,
  };
}

function readStringInitializer(sourceText: string, span: SourceSpan, location: string): string {
  const start = skipTrivia(sourceText, span.start);
  const quote = sourceText[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    throw new Error(`${location} must be a string literal.`);
  }
  const end = quote === '`' ? findTemplateEnd(sourceText, start, location) : findStringEnd(sourceText, start, quote);
  const after = skipTrivia(sourceText, end + 1);
  if (after < span.end) {
    throw new Error(`${location} must be a string literal.`);
  }
  return sourceText.slice(start + 1, end);
}

function parseObjectProperties(
  sourceText: string,
  objectStart: number,
  objectEnd: number,
  modulePath: string,
): PropertySpan[] {
  const properties: PropertySpan[] = [];
  let cursor = objectStart + 1;
  while (cursor < objectEnd) {
    cursor = skipTriviaAndCommas(sourceText, cursor);
    if (cursor >= objectEnd) break;

    const name = readPropertyName(sourceText, cursor, `${modulePath} object`);
    cursor = skipTrivia(sourceText, name.end);
    if (sourceText[cursor] !== ':') {
      throw new Error(`inlineSqlfu(...) in ${modulePath} only supports property assignments.`);
    }
    const valueStart = cursor + 1;
    const valueEnd = findTopLevelValueEnd(sourceText, valueStart, objectEnd);
    properties.push({
      name: name.value,
      start: valueStart,
      end: valueEnd,
    });
    cursor = valueEnd + 1;
  }
  Object.defineProperty(properties, sourceTextSymbol, {value: sourceText});
  return properties;
}

function parseArrayElements(sourceText: string, array: SourceSpan): SourceSpan[] {
  const elements: SourceSpan[] = [];
  let cursor = array.start + 1;
  while (cursor < array.end) {
    cursor = skipTriviaAndCommas(sourceText, cursor);
    if (cursor >= array.end) break;
    const end = findTopLevelValueEnd(sourceText, cursor, array.end);
    elements.push({start: cursor, end});
    cursor = end + 1;
  }
  return elements;
}

function readPropertyName(sourceText: string, start: number, location: string): {value: string; end: number} {
  const quote = sourceText[start];
  if (quote === "'" || quote === '"' || quote === '`') {
    const end = quote === '`' ? findTemplateEnd(sourceText, start, location) : findStringEnd(sourceText, start, quote);
    return {value: sourceText.slice(start + 1, end), end: end + 1};
  }
  if (!isIdentifierStart(sourceText[start] || '')) {
    throw new Error(`${location} name must be an identifier or string literal.`);
  }
  let end = start + 1;
  while (isIdentifierPart(sourceText[end] || '')) {
    end += 1;
  }
  return {value: sourceText.slice(start, end), end};
}

function findTopLevelValueEnd(sourceText: string, start: number, limit: number): number {
  let cursor = start;
  while (cursor < limit) {
    const char = sourceText[cursor];
    if (char === ',' || char === '}' || char === ']') {
      return cursor;
    }
    if (char === '{') {
      cursor = findMatchingDelimiter(sourceText, cursor, '{', '}') + 1;
      continue;
    }
    if (char === '[') {
      cursor = findMatchingDelimiter(sourceText, cursor, '[', ']') + 1;
      continue;
    }
    if (char === '(') {
      cursor = findMatchingDelimiter(sourceText, cursor, '(', ')') + 1;
      continue;
    }
    cursor = skipSourceElement(sourceText, cursor);
  }
  return limit;
}

function findMatchingDelimiter(sourceText: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === open) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
      cursor += 1;
      continue;
    }
    cursor = skipSourceElement(sourceText, cursor);
  }
  throw new Error(`Unbalanced ${open}${close} in inlineSqlfu(...) source.`);
}

function findMatchingAngle(sourceText: string, openIndex: number): number {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === '<') {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === '>') {
      depth -= 1;
      if (depth === 0) return cursor;
      cursor += 1;
      continue;
    }
    cursor = skipSourceElement(sourceText, cursor);
  }
  throw new Error('Unbalanced sql<...> type argument in inlineSqlfu(...) source.');
}

function forEachCodeIndex(sourceText: string, callback: (index: number) => void): void {
  let cursor = 0;
  while (cursor < sourceText.length) {
    callback(cursor);
    cursor = skipSourceElement(sourceText, cursor);
  }
}

function skipSourceElement(sourceText: string, index: number): number {
  const char = sourceText[index];
  const next = sourceText[index + 1];
  if (char === '/' && next === '/') return skipLineComment(sourceText, index);
  if (char === '/' && next === '*') return skipBlockComment(sourceText, index);
  if (char === "'" || char === '"') return findStringEnd(sourceText, index, char) + 1;
  if (char === '`') return skipTemplateLiteral(sourceText, index);
  return index + 1;
}

function skipTrivia(sourceText: string, index: number): number {
  let cursor = index;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    const next = sourceText[cursor + 1];
    if (/\s/u.test(char || '')) {
      cursor += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      cursor = skipLineComment(sourceText, cursor);
      continue;
    }
    if (char === '/' && next === '*') {
      cursor = skipBlockComment(sourceText, cursor);
      continue;
    }
    return cursor;
  }
  return cursor;
}

function skipTriviaAndCommas(sourceText: string, index: number): number {
  let cursor = index;
  while (cursor < sourceText.length) {
    const next = skipTrivia(sourceText, cursor);
    if (sourceText[next] !== ',') return next;
    cursor = next + 1;
  }
  return cursor;
}

function skipLineComment(sourceText: string, index: number): number {
  const end = sourceText.indexOf('\n', index + 2);
  return end === -1 ? sourceText.length : end + 1;
}

function skipBlockComment(sourceText: string, index: number): number {
  const end = sourceText.indexOf('*/', index + 2);
  if (end === -1) {
    throw new Error('Unclosed block comment in inlineSqlfu(...) source.');
  }
  return end + 2;
}

function findStringEnd(sourceText: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor;
    cursor += 1;
  }
  throw new Error('Unclosed string literal in inlineSqlfu(...) source.');
}

function findTemplateEnd(sourceText: string, start: number, location: string): number {
  let cursor = start + 1;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '$' && sourceText[cursor + 1] === '{') {
      throw new Error(`${location} cannot use template interpolations.`);
    }
    if (char === '`') return cursor;
    cursor += 1;
  }
  throw new Error(`Unclosed template literal in ${location}.`);
}

function skipTemplateLiteral(sourceText: string, start: number): number {
  let cursor = start + 1;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '`') return cursor + 1;
    cursor += 1;
  }
  throw new Error('Unclosed template literal in inlineSqlfu(...) source.');
}

function startsWithIdentifier(sourceText: string, index: number, identifier: string): boolean {
  return sourceText.slice(index, index + identifier.length) === identifier;
}

function isIdentifierStart(value: string): boolean {
  return /[A-Za-z_$]/u.test(value);
}

function isIdentifierPart(value: string): boolean {
  return /[A-Za-z0-9_$]/u.test(value);
}

function applyReplacements(
  sourceText: string,
  replacements: {start: number; end: number; text: string}[],
): string {
  return replacements
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.text}${current.slice(replacement.end)}`,
      sourceText,
    );
}

function lineIndentAt(sourceText: string, index: number): string {
  const lineStart = sourceText.lastIndexOf('\n', index - 1) + 1;
  return sourceText.slice(lineStart, index).match(/^[ \t]*/)?.[0] || '';
}

function renderInlineMigrationObject(indent: string, migration: {name: string; content: string}): string {
  const content = migration.content.trim();
  if (!content.includes('\n')) {
    return `${indent}{ name: ${singleQuoted(migration.name)}, content: sql\`${escapeTemplateLiteral(content)}\` }`;
  }
  const bodyIndent = `${indent}  `;
  const body = content
    .split('\n')
    .map((line) => `${bodyIndent}${escapeTemplateLiteral(line.trimEnd())}`)
    .join('\n');
  return `${indent}{ name: ${singleQuoted(migration.name)}, content: sql\`\n${body}\n${indent}\` }`;
}

function singleQuoted(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function escapeTemplateLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

const sourceTextSymbol = Symbol('sourceText');

function sourceTextFor(properties: PropertySpan[]): string {
  return (properties as unknown as {[sourceTextSymbol]: string})[sourceTextSymbol];
}
