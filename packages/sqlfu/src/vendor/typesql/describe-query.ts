import type { PreprocessedSql, NamedParamInfo } from './types.js';
import type { InferType, DbType } from './mysql-mapping.js';

export function verifyNotInferred(type: InferType): DbType | 'any' {
	if (type === '?' || type === 'any') return 'any';
	if (type === 'number') return 'double';
	return type;
}

//http://dev.mysql.com/doc/refman/8.0/en/identifiers.html
//Permitted characters in unquoted identifiers: ASCII: [0-9,a-z,A-Z$_] (basic Latin letters, digits 0-9, dollar, underscore)
export function preprocessSql(sql: string, dialect: 'postgres' | 'mysql' | 'sqlite'): PreprocessedSql {
	const namedParamRegex = /:[a-zA-Z$_][a-zA-Z\d$_]*/g;
	const tempSql = sql.replace(/::([a-zA-Z0-9_]+)/g, (_, type) => `/*TYPECAST*/${type}`);

	const lines = tempSql.split('\n');
	let newSql = '';
	const paramMap: Record<string, number> = {};
	const namedParameters: NamedParamInfo[] = [];
	let paramIndex = 1;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		if (!line.trim().startsWith('--')) {
			// Extract named params (:paramName)
			const matches = [...line.matchAll(namedParamRegex)];
			if (dialect === 'postgres') {
				const positionalParamRegex = /\$(\d+)/g;
				const positionalMatches = [...line.matchAll(positionalParamRegex)];
				for (const match of positionalMatches) {
					const paramNumber = parseInt(match[1], 10);
					namedParameters.push({
						paramName: `param${paramNumber}`,
						paramNumber: paramNumber
					});
				}
			}

			for (const match of matches) {
				const fullMatch = match[0];
				const paramName = fullMatch.slice(1);

				if (!paramMap[paramName]) {
					paramMap[paramName] = paramIndex++;
				}
				namedParameters.push({ paramName, paramNumber: paramMap[paramName] });
			}

			if (dialect === 'postgres') {
				// Replace :paramName with $number
				for (const param of Object.keys(paramMap)) {
					const regex = new RegExp(`:${param}\\b`, 'g');
					line = line.replace(regex, `$${paramMap[param]}`);
				}
			} else {
				// For mysql/sqlite, replace :paramName with '?'
				line = line.replace(namedParamRegex, '?');
			}
		}

		newSql += line;
		if (i !== lines.length - 1) newSql += '\n';
	}

	newSql = newSql.replace(/\/\*TYPECAST\*\/([a-zA-Z0-9_]+)/g, (_, type) => `::${type}`);

	return {
		sql: newSql,
		namedParameters,
	};
}

//https://stackoverflow.com/a/1695647
export function hasAnnotation(sql: string, annotation: string) {
	const regex = `-- ${annotation}`;
	return sql.match(new RegExp(regex)) != null;
}
