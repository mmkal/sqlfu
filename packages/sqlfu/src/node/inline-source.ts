import fs from 'node:fs/promises';

import type {Migration} from '../migrations/index.js';
import type {QueryResultMode} from '../types.js';

export type InlineConfigSource = {
  name: string;
  className?: string;
  modulePath: string;
  sourceText: string;
  definitions: InlineSqlTemplate;
  migrations: InlineMigrationSource[];
  migrationsArray: InlineMigrationsArraySource;
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

export type InlineMigrationsArraySource =
  | {
      kind: 'present';
      insertPosition: number;
    }
  | {
      kind: 'missing';
      insertPropertyPosition: number;
      propertyIndent: string;
    };

export type InlineQuerySource = {
  name: string;
  content: InlineSqlTemplate;
  object?: SourceSpan;
  type?: PropertySpan;
  mode?: PropertySpan;
};

export type InlineQueryType = {
  className?: string;
  configName: string;
  queryName: string;
  type: string;
  mode: QueryResultMode;
};

type InlineConfigTarget = {
  className?: string;
  name: string;
};

type InlineConfigCall = {
  target: InlineConfigTarget | null;
  openParen: number;
};

export async function readInlineConfigSources(modulePath: string): Promise<InlineConfigSource[]> {
  const sourceText = await fs.readFile(modulePath, 'utf8');
  return parseInlineConfigSources(modulePath, sourceText);
}

export function parseInlineConfigSources(modulePath: string, sourceText: string): InlineConfigSource[] {
  const sources: InlineConfigSource[] = [];
  for (const inlineCall of findDefineConfigCalls(sourceText)) {
    const source = parseInlineConfigSourceForCall(modulePath, sourceText, inlineCall);
    if (source) sources.push(source);
  }
  const duplicate = firstDuplicate(sources.map((source) => inlineConfigReferenceName(source)));
  if (duplicate) {
    throw new Error(`${modulePath} contains more than one inline defineConfig(...) call assigned to "${duplicate}".`);
  }
  return sources;
}

function parseInlineConfigSourceForCall(
  modulePath: string,
  sourceText: string,
  inlineCall: InlineConfigCall,
): InlineConfigSource | null {
  const definitionStart = skipTrivia(sourceText, inlineCall.openParen + 1);
  if (sourceText[definitionStart] !== '{') {
    return null;
  }
  const definitionEnd = findMatchingDelimiter(sourceText, definitionStart, '{', '}');
  if (!looksLikeInlineDefineConfigObject(sourceText, definitionStart, definitionEnd)) {
    return null;
  }
  const definitionProperties = parseObjectProperties(sourceText, definitionStart, definitionEnd, modulePath);
  if (!isInlineDefineConfigShape(sourceText, definitionProperties)) {
    return null;
  }

  const afterDefinition = skipTrivia(sourceText, definitionEnd + 1);
  if (sourceText[afterDefinition] !== ')') {
    throw new Error(`inline defineConfig(...) in ${modulePath} must contain exactly one object literal argument.`);
  }
  if (!inlineCall.target) {
    throw new Error(
      `${modulePath} inline defineConfig(...) calls must be assigned to top-level const declarations or static properties on top-level named classes.`,
    );
  }

  const definitions = readSqlProperty(definitionProperties, 'definitions', modulePath);
  const migrationsProperty = definitionProperties.find((property) => property.name === 'migrations');
  const migrationsArray = migrationsProperty && readArrayInitializer(sourceText, migrationsProperty, 'migrations', modulePath);
  const queriesProperty = readProperty(definitionProperties, 'queries', modulePath);
  const queriesObject = readObjectInitializer(sourceText, queriesProperty, 'queries', modulePath);

  return {
    className: inlineCall.target.className,
    name: inlineCall.target.name,
    modulePath,
    sourceText,
    definitions,
    migrations: migrationsArray ? readMigrationSources(sourceText, migrationsArray, modulePath) : [],
    migrationsArray: migrationsArray
      ? {
          kind: 'present',
          insertPosition: migrationsArray.end,
        }
      : {
          kind: 'missing',
          insertPropertyPosition: lineStartIndex(sourceText, queriesProperty.nameStart),
          propertyIndent: lineIndentAt(sourceText, queriesProperty.nameStart),
        },
    queries: readQuerySources(sourceText, queriesObject, modulePath),
  };
}

function looksLikeInlineDefineConfigObject(
  sourceText: string,
  definitionStart: number,
  definitionEnd: number,
): boolean {
  const definitionBody = sourceText.slice(definitionStart + 1, definitionEnd);
  return definitionBody.includes('sql`') || definitionBody.includes('sql<');
}

function isInlineDefineConfigShape(sourceText: string, properties: PropertySpan[]): boolean {
  const definitions = properties.find((property) => property.name === 'definitions');
  if (!definitions) return false;
  const queries = properties.find((property) => property.name === 'queries');
  if (!queries) return false;
  const definitionsStart = skipTrivia(sourceText, definitions.start);
  if (!startsWithIdentifier(sourceText, definitionsStart, 'sql')) return false;
  const previous = sourceText[definitionsStart - 1] || '';
  const next = sourceText[definitionsStart + 'sql'.length] || '';
  if (isIdentifierPart(previous) || isIdentifierPart(next)) return false;
  const afterTag = skipTrivia(sourceText, definitionsStart + 'sql'.length);
  return sourceText[afterTag] === '`' || sourceText[afterTag] === '<';
}

export async function writeInlineQueryTypes(modulePath: string, queryTypes: InlineQueryType[]): Promise<boolean> {
  const inlines = await readRequiredInlineConfigSources(modulePath);
  const style = inferInlineSourceStyle(inlines[0].sourceText);
  const replacements = inlines.flatMap((inline) =>
    inline.queries.flatMap((query) => {
      const queryType = queryTypes.find(
        (candidate) =>
          candidate.className === inline.className &&
          candidate.configName === inline.name &&
          candidate.queryName === query.name,
      );
      if (!queryType) {
        throw new Error(`Missing generated inline query type for ${inlineConfigReferenceName(inline)}.${query.name}.`);
      }
      return renderInlineQueryTypeReplacements(inlines[0].sourceText, query, queryType, style);
    }),
  );
  const output = applyReplacements(inlines[0].sourceText, replacements);
  if (output === inlines[0].sourceText) {
    return false;
  }
  await fs.writeFile(modulePath, output);
  return true;
}

function renderInlineQueryTypeReplacements(
  sourceText: string,
  query: InlineQuerySource,
  queryType: InlineQueryType,
  style: InlineSourceStyle,
): SourceReplacement[] {
  if (!query.object) {
    const replacement = replaceSqlTagPrefix(sourceText, query.content, queryType);
    return replacement ? [replacement] : [];
  }

  const typeValue = `{} as ${queryType.type}`;
  const modeValue = quotedString(queryType.mode, style.quote);
  if (
    query.type &&
    query.mode &&
    query.type.start < query.mode.start &&
    canReplaceGeneratedPropertyLines(sourceText, query.type, query.mode)
  ) {
    return [
      replacePropertyLines(sourceText, query.type, query.mode, [`mode: ${modeValue}`, `$type: ${typeValue}`], style),
    ];
  }

  const replacements: SourceReplacement[] = [];

  if (query.mode) replacements.push(replacePropertyValue(sourceText, query.mode, modeValue));
  if (query.type) replacements.push(replacePropertyValue(sourceText, query.type, typeValue));

  if (!query.mode && query.type) replacements.push(insertPropertyBefore(sourceText, query.type, `mode: ${modeValue}`));
  if (!query.mode && !query.type) {
    replacements.push(
      renderInlineQueryInsertedProperties(
        sourceText,
        query.object,
        [`mode: ${modeValue}`, `$type: ${typeValue}`],
        style,
      ),
    );
  } else if (!query.type) {
    replacements.push(renderInlineQueryInsertedProperties(sourceText, query.object, [`$type: ${typeValue}`], style));
  }

  return replacements;
}

function replaceSqlTagPrefix(
  sourceText: string,
  template: InlineSqlTemplate,
  queryType: InlineQueryType,
): SourceReplacement | null {
  const text = renderSqlTagPrefix(queryType);
  const existingText = sourceText.slice(template.tagStart, template.templateStart);
  if (normalizeInlineTypeTagPrefix(existingText) === normalizeInlineTypeTagPrefix(text)) {
    return null;
  }
  return {
    start: template.tagStart,
    end: template.templateStart,
    text,
  };
}

function renderSqlTagPrefix(queryType: InlineQueryType): string {
  return `sql.${queryType.mode === 'metadata' ? 'run' : queryType.mode}<${queryType.type}>`;
}

function normalizeInlineTypeTagPrefix(value: string): string {
  return value.replace(/;\s*\}/gu, '}').replace(/\s+/g, '');
}

function canReplaceGeneratedPropertyLines(
  sourceText: string,
  firstProperty: PropertySpan,
  lastProperty: PropertySpan,
): boolean {
  const firstLineStart = lineStartIndex(sourceText, firstProperty.start);
  const firstLineEnd = lineEndIndex(sourceText, firstProperty.end);
  const lastLineStart = lineStartIndex(sourceText, lastProperty.start);
  if (firstLineStart === lastLineStart) return false;

  const firstValue = sourceText.slice(firstProperty.start, firstProperty.end);
  const lastValue = sourceText.slice(lastProperty.start, lastProperty.end);
  if (firstValue.includes('\n') || lastValue.includes('\n')) return false;

  const firstPrefix = sourceText.slice(firstLineStart, firstProperty.start);
  const firstSuffix = sourceText.slice(firstProperty.end, firstLineEnd);
  const betweenLines = sourceText.slice(firstLineEnd, lastLineStart);
  const lastPrefix = sourceText.slice(lastLineStart, lastProperty.start);

  return (
    /^\s*\$type\s*:\s*$/u.test(firstPrefix) &&
    /^\s*,?\s*$/u.test(firstSuffix) &&
    betweenLines.trim() === '' &&
    /^\s*mode\s*:\s*$/u.test(lastPrefix)
  );
}

function replacePropertyLines(
  sourceText: string,
  firstProperty: PropertySpan,
  lastProperty: PropertySpan,
  lines: string[],
  style: InlineSourceStyle,
): SourceReplacement {
  const start = lineStartIndex(sourceText, firstProperty.start);
  const end = lineEndIndex(sourceText, lastProperty.end);
  const indent = lineIndentAt(sourceText, firstProperty.start);
  return {
    start,
    end,
    text:
      lines.map((line, index) => `${indent}${line}${propertySeparator(index, lines.length, style)}`).join('\n') +
      (sourceText[end - 1] === '\n' ? '\n' : ''),
  };
}

function replacePropertyValue(sourceText: string, property: PropertySpan, text: string): SourceReplacement {
  return {
    start: skipTrivia(sourceText, property.start),
    end: trimEndIndex(sourceText, property.end),
    text,
  };
}

function insertPropertyBefore(sourceText: string, property: PropertySpan, text: string): SourceReplacement {
  const start = lineStartIndex(sourceText, property.start);
  return {
    start,
    end: start,
    text: `${lineIndentAt(sourceText, property.start)}${text},\n`,
  };
}

function renderInlineQueryInsertedProperties(
  sourceText: string,
  object: SourceSpan,
  properties: string[],
  style: InlineSourceStyle,
): SourceReplacement {
  const insertionStart = trimEndIndex(sourceText, object.end);
  const beforeClose = sourceText.slice(object.start + 1, insertionStart);
  const closingIndent = lineIndentAt(sourceText, object.end);
  const propertyIndent = `${closingIndent}${style.indent}`;
  const prefix = beforeClose.length === 0 ? '\n' : `${beforeClose.endsWith(',') ? '' : ','}\n`;
  const body = properties
    .map((property, index) => `${propertyIndent}${property}${propertySeparator(index, properties.length, style)}`)
    .join('\n');
  return {
    start: insertionStart,
    end: object.end,
    text: `${prefix}${body}\n${closingIndent}`,
  };
}

export async function appendInlineMigration(
  modulePath: string,
  migration: {
    app?: string;
    name: string;
    content: string;
  },
): Promise<void> {
  const inline = await readRequiredInlineConfigSource(modulePath, migration.app);
  const style = inferInlineSourceStyle(inline.sourceText);
  if (inline.migrationsArray.kind === 'missing') {
    const insertPosition = inline.migrationsArray.insertPropertyPosition;
    const elementIndent = `${inline.migrationsArray.propertyIndent}${style.indent}`;
    const property =
      `${inline.migrationsArray.propertyIndent}migrations: [\n` +
      `${renderInlineMigrationObject(elementIndent, migration, style)}${style.trailingComma ? ',' : ''}\n` +
      `${inline.migrationsArray.propertyIndent}],\n`;
    await fs.writeFile(
      modulePath,
      `${inline.sourceText.slice(0, insertPosition)}${property}${inline.sourceText.slice(insertPosition)}`,
    );
    return;
  }

  const insertPosition = inline.migrationsArray.insertPosition;
  const beforeInsert = inline.sourceText.slice(0, insertPosition).trimEnd();
  const closingIndent = lineIndentAt(inline.sourceText, insertPosition);
  const elementIndent = `${closingIndent}${style.indent}`;
  const prefix = inline.migrations.length === 0 ? '\n' : `${beforeInsert.endsWith(',') ? '' : ','}\n`;
  const insertion = `${prefix}${renderInlineMigrationObject(elementIndent, migration, style)}${style.trailingComma ? ',' : ''}\n${closingIndent}`;
  await fs.writeFile(modulePath, `${beforeInsert}${insertion}${inline.sourceText.slice(insertPosition)}`);
}

export function inlineMigrationsToMigrationFiles(inline: InlineConfigSource): Migration[] {
  return inline.migrations.map((migration) => ({
    path: `${migration.name}.sql`,
    content: migration.content.sql,
  }));
}

async function readRequiredInlineConfigSources(modulePath: string): Promise<InlineConfigSource[]> {
  const inlines = await readInlineConfigSources(modulePath);
  if (inlines.length === 0) {
    throw new Error(`No inline defineConfig(...) call found in ${modulePath}.`);
  }
  return inlines;
}

async function readRequiredInlineConfigSource(
  modulePath: string,
  name: string | undefined,
): Promise<InlineConfigSource> {
  const inlines = await readRequiredInlineConfigSources(modulePath);
  if (!name && inlines.length > 1) {
    throw new Error(
      `${modulePath} contains more than one inline defineConfig(...) call. Pass an inline app name to select one; use ClassName.propertyName for static class configs.`,
    );
  }
  const inline = name ? inlines.find((candidate) => inlineConfigReferenceName(candidate) === name) : inlines[0];
  if (!inline) {
    throw new Error(`No inline defineConfig(...) call named "${name}" found in ${modulePath}.`);
  }
  return inline;
}

function findDefineConfigCalls(sourceText: string): InlineConfigCall[] {
  const calls: InlineConfigCall[] = [];
  forEachCodeIndexWithDepth(sourceText, (index, depth) => {
    if (!startsWithIdentifier(sourceText, index, 'defineConfig')) return;
    const previous = sourceText[index - 1] || '';
    const next = sourceText[index + 'defineConfig'.length] || '';
    if (isIdentifierPart(previous) || previous === '.' || isIdentifierPart(next)) return;
    const openParen = skipTrivia(sourceText, index + 'defineConfig'.length);
    if (sourceText[openParen] === '(') {
      calls.push({
        target: readDefineConfigTarget(sourceText, index, depth),
        openParen,
      });
    }
  });
  return calls;
}

function isTopLevelDepth(depth: SourceDepth): boolean {
  return depth.braces === 0 && depth.brackets === 0 && depth.parens === 0;
}

function isClassStaticPropertyDepth(depth: SourceDepth): boolean {
  return depth.braces === 1 && depth.brackets === 0 && depth.parens === 0;
}

function readDefineConfigTarget(sourceText: string, index: number, depth: SourceDepth): InlineConfigTarget | null {
  if (isTopLevelDepth(depth)) {
    const name = readDefineConfigConstName(sourceText, index);
    return name ? {name} : null;
  }
  if (isClassStaticPropertyDepth(depth)) {
    return readDefineConfigStaticPropertyTarget(sourceText, index);
  }
  return null;
}

function readDefineConfigConstName(sourceText: string, index: number): string | null {
  const prefix = sourceText.slice(0, index);
  const match = prefix.match(/(?:^|[;\n])\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*:[^=]+)?\s*=\s*$/u);
  return match?.[1] || null;
}

function readDefineConfigStaticPropertyTarget(sourceText: string, index: number): InlineConfigTarget | null {
  const classBodyStart = findEnclosingTopLevelBrace(sourceText, index);
  if (classBodyStart === null) return null;
  const className = readTopLevelClassName(sourceText, classBodyStart);
  if (!className) return null;
  const name = readStaticPropertyName(sourceText, classBodyStart + 1, index);
  return name ? {className, name} : null;
}

function findEnclosingTopLevelBrace(sourceText: string, limit: number): number | null {
  let cursor = 0;
  let braces = 0;
  let topLevelBrace: number | null = null;
  while (cursor < limit) {
    const skipped = skipSourceElement(sourceText, cursor);
    if (skipped !== cursor + 1) {
      cursor = skipped;
      continue;
    }
    const char = sourceText[cursor];
    if (char === '{') {
      if (braces === 0) topLevelBrace = cursor;
      braces += 1;
    } else if (char === '}') {
      braces -= 1;
      if (braces === 0) topLevelBrace = null;
    }
    cursor += 1;
  }
  return braces === 1 ? topLevelBrace : null;
}

function readTopLevelClassName(sourceText: string, classBodyStart: number): string | null {
  const prefix = sourceText.slice(0, classBodyStart);
  const match = prefix.match(
    /(?:^|[;\n])\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{]*$/u,
  );
  return match?.[1] || null;
}

function readStaticPropertyName(sourceText: string, classBodyStart: number, index: number): string | null {
  const prefix = sourceText.slice(classBodyStart, index);
  const match = prefix.match(
    /(?:^|[;\n])\s*(?:(?:public|private|protected|readonly|accessor)\s+)*static\s+(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*!?(?:\s*:[^=]+)?\s*=\s*$/u,
  );
  return match?.[1] || null;
}

function inlineConfigReferenceName(inline: Pick<InlineConfigSource, 'className' | 'name'>): string {
  return inline.className ? `${inline.className}.${inline.name}` : inline.name;
}

function firstDuplicate(values: string[]): string | undefined {
  const seen: string[] = [];
  for (const value of values) {
    if (seen.includes(value)) return value;
    seen.push(value);
  }
  return undefined;
}

type SourceSpan = {
  start: number;
  end: number;
};

type SourceReplacement = SourceSpan & {
  text: string;
};

type PropertySpan = SourceSpan & {
  name: string;
  nameStart: number;
};

function readSqlProperty(properties: PropertySpan[], name: string, modulePath: string): InlineSqlTemplate {
  return readSqlTemplate(
    sourceTextFor(properties),
    readProperty(properties, name, modulePath),
    `${modulePath} ${name}`,
  );
}

function readArrayInitializer(
  sourceText: string,
  property: PropertySpan,
  name: string,
  modulePath: string,
): SourceSpan {
  const start = skipTrivia(sourceText, property.start);
  if (sourceText[start] !== '[') {
    throw new Error(`inline defineConfig(...) in ${modulePath} must provide "${name}" as an array literal.`);
  }
  return {start, end: findMatchingDelimiter(sourceText, start, '[', ']')};
}

function readObjectInitializer(
  sourceText: string,
  property: PropertySpan,
  name: string,
  modulePath: string,
): SourceSpan {
  const start = skipTrivia(sourceText, property.start);
  if (sourceText[start] !== '{') {
    throw new Error(`inline defineConfig(...) in ${modulePath} must provide "${name}" as an object literal.`);
  }
  return {start, end: findMatchingDelimiter(sourceText, start, '{', '}')};
}

function readProperty(properties: PropertySpan[], name: string, modulePath: string): PropertySpan {
  const property = properties.find((candidate) => candidate.name === name);
  if (!property) {
    throw new Error(`inline defineConfig(...) in ${modulePath} must provide a "${name}" property assignment.`);
  }
  return property;
}

function readMigrationSources(sourceText: string, array: SourceSpan, modulePath: string): InlineMigrationSource[] {
  return parseArrayElements(sourceText, array).map((element, index) => {
    const objectStart = skipTrivia(sourceText, element.start);
    if (sourceText[objectStart] !== '{') {
      throw new Error(`inline defineConfig(...) migration ${index} in ${modulePath} must be an object literal.`);
    }
    const objectEnd = findMatchingDelimiter(sourceText, objectStart, '{', '}');
    const properties = parseObjectProperties(sourceText, objectStart, objectEnd, modulePath);
    const name = readStringInitializer(
      sourceText,
      readProperty(properties, 'name', modulePath),
      `${modulePath} migration name`,
    );
    const content = readSqlTemplate(
      sourceText,
      readProperty(properties, 'content', modulePath),
      `${modulePath} migration ${name}`,
    );
    return {name, content};
  });
}

function readQuerySources(sourceText: string, object: SourceSpan, modulePath: string): InlineQuerySource[] {
  return parseObjectProperties(sourceText, object.start, object.end, modulePath).map((property) => {
    const name = property.name;
    const objectStart = skipTrivia(sourceText, property.start);
    if (sourceText[objectStart] !== '{') {
      return {
        name,
        content: readSqlTemplate(sourceText, property, `${modulePath} query ${name}`),
      };
    }
    const objectEnd = findMatchingDelimiter(sourceText, objectStart, '{', '}');
    const properties = parseObjectProperties(sourceText, objectStart, objectEnd, modulePath);
    const content = readSqlProperty(properties, 'query', `${modulePath} query ${name}`);
    return {
      name,
      content,
      object: {start: objectStart, end: objectEnd},
      type: properties.find((candidate) => candidate.name === '$type'),
      mode: properties.find((candidate) => candidate.name === 'mode'),
    };
  });
}

function readSqlTemplate(sourceText: string, span: SourceSpan, location: string): InlineSqlTemplate {
  const tagStart = skipTrivia(sourceText, span.start);
  if (!startsWithIdentifier(sourceText, tagStart, 'sql')) {
    throw new Error(`${location} must use the sql tag.`);
  }
  let cursor = skipTrivia(sourceText, tagStart + 'sql'.length);
  if (sourceText[cursor] === '.') {
    const modeName = readIdentifier(sourceText, skipTrivia(sourceText, cursor + 1), `${location} sql tag`);
    if (!isQueryResultModeTag(modeName.value)) {
      throw new Error(`${location} uses unsupported sql tag mode ${JSON.stringify(modeName.value)}.`);
    }
    cursor = skipTrivia(sourceText, modeName.end);
  }
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

function readIdentifier(sourceText: string, start: number, location: string): {value: string; end: number} {
  if (!isIdentifierStart(sourceText[start] || '')) {
    throw new Error(`${location} must use an identifier.`);
  }
  let end = start + 1;
  while (isIdentifierPart(sourceText[end] || '')) {
    end += 1;
  }
  return {value: sourceText.slice(start, end), end};
}

function isQueryResultModeTag(value: string): value is QueryResultMode | 'run' {
  return value === 'many' || value === 'nullableOne' || value === 'one' || value === 'metadata' || value === 'run';
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
      throw new Error(`inline defineConfig(...) in ${modulePath} only supports property assignments.`);
    }
    const valueStart = cursor + 1;
    const valueEnd = findTopLevelValueEnd(sourceText, valueStart, objectEnd);
    properties.push({
      name: name.value,
      nameStart: cursor,
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
  throw new Error(`Unbalanced ${open}${close} in inline defineConfig(...) source.`);
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
  throw new Error('Unbalanced sql<...> type argument in inline defineConfig(...) source.');
}

type SourceDepth = {
  braces: number;
  brackets: number;
  parens: number;
};

function forEachCodeIndexWithDepth(sourceText: string, callback: (index: number, depth: SourceDepth) => void): void {
  let cursor = 0;
  const depth = {braces: 0, brackets: 0, parens: 0};
  while (cursor < sourceText.length) {
    callback(cursor, depth);
    const skipped = skipSourceElement(sourceText, cursor);
    if (skipped !== cursor + 1) {
      cursor = skipped;
      continue;
    }
    const char = sourceText[cursor];
    if (char === '{') depth.braces += 1;
    if (char === '}') depth.braces -= 1;
    if (char === '[') depth.brackets += 1;
    if (char === ']') depth.brackets -= 1;
    if (char === '(') depth.parens += 1;
    if (char === ')') depth.parens -= 1;
    cursor += 1;
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
    throw new Error('Unclosed block comment in inline defineConfig(...) source.');
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
  throw new Error('Unclosed string literal in inline defineConfig(...) source.');
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
    if (char === '$' && sourceText[cursor + 1] === '{') {
      cursor = findMatchingDelimiter(sourceText, cursor + 1, '{', '}') + 1;
      continue;
    }
    if (char === '`') return cursor + 1;
    cursor += 1;
  }
  throw new Error('Unclosed template literal in inline defineConfig(...) source.');
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

function applyReplacements(sourceText: string, replacements: {start: number; end: number; text: string}[]): string {
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

function lineStartIndex(sourceText: string, index: number): number {
  return sourceText.lastIndexOf('\n', index - 1) + 1;
}

function lineEndIndex(sourceText: string, index: number): number {
  const lineEnd = sourceText.indexOf('\n', index);
  return lineEnd === -1 ? index : lineEnd + 1;
}

function trimEndIndex(sourceText: string, end: number): number {
  let index = end;
  while (index > 0 && /\s/u.test(sourceText[index - 1] || '')) {
    index -= 1;
  }
  return index;
}

type InlineSourceStyle = {
  indent: string;
  quote: '"' | "'";
  trailingComma: boolean;
};

function inferInlineSourceStyle(sourceText: string): InlineSourceStyle {
  const indent = sourceText
    .split('\n')
    .map((line) => line.match(/^[ \t]+/u)?.[0])
    .find(Boolean);
  const quote = sourceText.match(/['"]/u)?.[0] as `"` | `'`;
  return {
    indent: indent || '  ',
    quote: (quote || `'`) as InlineSourceStyle['quote'],
    trailingComma: /,\s*[}\]]/u.test(sourceText),
  };
}

function renderInlineMigrationObject(
  indent: string,
  migration: {name: string; content: string},
  style: InlineSourceStyle,
): string {
  const isMultiline = migration.content.includes('\n');
  const content = migration.content.trim();
  if (!isMultiline) {
    return `${indent}{ name: ${quotedString(migration.name, style.quote)}, content: sql\`${escapeTemplateLiteral(content)}\` }`;
  }
  const propertyIndent = `${indent}${style.indent}`;
  const bodyIndent = `${propertyIndent}${style.indent}`;
  const body = content
    .split('\n')
    .map((line) => `${bodyIndent}${escapeTemplateLiteral(line.trimEnd())}`)
    .join('\n');
  return `${indent}{\n${propertyIndent}name: ${quotedString(migration.name, style.quote)},\n${propertyIndent}content: sql\`\n${body}\n${propertyIndent}\`${style.trailingComma ? ',' : ''}\n${indent}}`;
}

function propertySeparator(index: number, length: number, style: InlineSourceStyle): string {
  return index < length - 1 || style.trailingComma ? ',' : '';
}

function quotedString(value: string, quote: '"' | "'"): string {
  return `${quote}${value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
}

function escapeTemplateLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

const sourceTextSymbol = Symbol('sourceText');

function sourceTextFor(properties: PropertySpan[]): string {
  return (properties as unknown as {[sourceTextSymbol]: string})[sourceTextSymbol];
}
