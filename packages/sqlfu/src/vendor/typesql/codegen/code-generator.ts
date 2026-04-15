import fs from 'node:fs';
import path, { parse } from 'node:path';
import { SchemaInfo } from '../schema-info.js';
import { DatabaseClient, TypeSqlError } from '../types.js';
import {type Either, isLeft} from '../../small-utils.js';
import { validateAndGenerateCode } from './sqlite.js';
import { ColumnSchema } from '../mysql-query-analyzer/types.js';
import { convertToCamelCaseName } from './shared/codegen-util.js';

export async function generateTsFile(client: DatabaseClient, sqlFile: string, tsFilePath: string, schemaInfo: SchemaInfo, isCrudFile: boolean) {
	const sqlContent = fs.readFileSync(sqlFile, 'utf8');

	if (sqlContent.trim() === '') {
		//ignore empty file
		return;
	}

	const { name: fileName } = parse(sqlFile);
	const queryName = convertToCamelCaseName(fileName);

	const tsContentResult = await generateTypeScriptContent({
		client,
		queryName,
		sqlContent,
		schemaInfo,
		isCrudFile,
	})

	if (isLeft(tsContentResult)) {
		console.error('ERROR: ', tsContentResult.left.description);
		console.error('at ', sqlFile);
		writeFile(tsFilePath, '//Invalid SQL');
		return;
	}
	const tsContent = tsContentResult.right;

	writeFile(tsFilePath, tsContent);
}

export async function generateTypeScriptContent(params: {
	client: DatabaseClient;
	queryName: string;
	sqlContent: string;
	schemaInfo: SchemaInfo;
	isCrudFile: boolean;
}): Promise<Either<TypeSqlError, string>> {
	const { client, queryName, sqlContent, schemaInfo, isCrudFile } = params;

	switch (client.type) {
		case 'sqlite':
		case 'better-sqlite3':
		case 'bun:sqlite':
		case 'libsql':
			return validateAndGenerateCode(client, sqlContent, queryName, schemaInfo.columns as ColumnSchema[], isCrudFile);
		case 'd1':
			return validateAndGenerateCode(client, sqlContent, queryName, schemaInfo.columns as ColumnSchema[], isCrudFile);
		case 'mysql2':
		case 'pg':
			throw new Error(`Unsupported TypeSQL dialect in vendored sqlite-only build: ${client.type}`);
	}
}

export function writeFile(filePath: string, tsContent: string) {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, tsContent);
}
