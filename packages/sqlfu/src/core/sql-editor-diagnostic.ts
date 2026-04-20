import type {SqlEditorDiagnostic} from '../ui/shared.js';

export function toSqlEditorDiagnostic(sql: string, error: unknown): SqlEditorDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const explicitLocation = locateExplicitPosition(sql, message);
  if (explicitLocation) return {...explicitLocation, message};

  const nearToken =
    message.match(/near ['"`]([^'"`]+)['"`]/i)?.[1] ??
    message.match(/no such (?:table|column):\s*([A-Za-z0-9_."]+)/i)?.[1] ??
    message.match(/Must select the join column:\s*([A-Za-z0-9_."]+)/i)?.[1];
  const tokenLocation = nearToken ? locateToken(sql, nearToken) : null;
  if (tokenLocation) return {...tokenLocation, message};

  return {...fallbackDiagnosticRange(sql), message};
}

export function isInternalUnsupportedSqlAnalysisError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return ['traverse_Sql_stmtContext', 'Not supported!'].includes(message);
}

function locateExplicitPosition(sql: string, message: string) {
  const lineColumnMatch = message.match(/line\s+(\d+)\D+column\s+(\d+)/i);
  if (!lineColumnMatch) return null;

  const lineNumber = Number(lineColumnMatch[1]);
  const columnNumber = Number(lineColumnMatch[2]);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber) || lineNumber < 1 || columnNumber < 1) {
    return null;
  }

  const lines = sql.split('\n');
  const targetLine = lines[lineNumber - 1];
  if (targetLine == null) return null;

  const from = lines.slice(0, lineNumber - 1).reduce((total, line) => total + line.length + 1, 0) + (columnNumber - 1);

  return {
    from,
    to: Math.min(sql.length, from + Math.max(1, targetLine.trim().length ? 1 : targetLine.length || 1)),
  };
}

function locateToken(sql: string, rawToken: string) {
  const token = rawToken.replace(/^["'`]+|["'`]+$/g, '');
  if (!token) return null;

  for (const candidate of [token, token.split('.').at(-1) ?? '']) {
    if (!candidate) continue;
    const index = sql.toLowerCase().indexOf(candidate.toLowerCase());
    if (index !== -1) {
      return {from: index, to: index + candidate.length};
    }
  }
  return null;
}

function fallbackDiagnosticRange(sql: string) {
  const firstNonWhitespace = sql.search(/\S/);
  const from = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return {from, to: Math.max(from + 1, sql.length)};
}
