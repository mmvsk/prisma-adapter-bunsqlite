/**
 * Base queryable class for adapter and transactions
 */

import { Database } from "bun:sqlite";
import {
	Debug,
	DriverAdapterError,
	type SqlQuery,
	type SqlResultSet,
} from "@prisma/driver-adapter-utils";

import type { PrismaBunSqliteOptions } from "./types.js";
import { convertDriverError } from "./errors.js";
import { getColumnTypes, mapArg, mapRow } from "./conversion.js";

export const ADAPTER_NAME = "prisma-adapter-bun-sqlite";
export const debug = Debug("prisma:driver-adapter:bun-sqlite");

/**
 * Base queryable class for both adapter and transactions
 */
export class BunSqliteQueryable {
	private readonly timestampFormat: "iso8601" | "unixepoch-ms";

	constructor(
		protected db: Database,
		protected adapterOptions?: PrismaBunSqliteOptions,
	) {
		this.timestampFormat = adapterOptions?.timestampFormat ?? "iso8601";
	}

	readonly provider = "sqlite" as const;
	readonly adapterName = ADAPTER_NAME;

	/**
	 * Execute a query and return the result set
	 */
	async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
		const tag = "[js::queryRaw]";
		debug(`${tag} %O`, query);

		try {
			// Map arguments from Prisma format to SQLite format
			// Always run mapArg to ensure strings for ints/decimals are coerced like the official adapters
			const args = query.args.map((arg, i) => {
				const argType = query.argTypes[i];
				return argType ? mapArg(arg, argType, this.timestampFormat) : arg;
			});

			// Use db.query() which caches compiled statements (vs db.prepare() which recompiles every time)
			const stmt = this.db.query(query.sql);

			// Get column metadata first to determine if this is a returning query
			const columnNames = (stmt as any).columnNames || [];
			const declaredTypes = (stmt as any).declaredTypes || [];

			// Check if this query returns columns (SELECT, INSERT...RETURNING, etc.)
			// If no columns, use stmt.run() to get lastInsertRowid
			// If columns exist, use stmt.values() to get row data
			if (columnNames.length === 0) {
				// Non-returning statement (INSERT, UPDATE, DELETE without RETURNING)
				// Use stmt.run() which returns { changes, lastInsertRowid }
				const result = stmt.run(...(args as any));
				return {
					columnNames: [],
					columnTypes: [],
					rows: [],
					// Include lastInsertId for non-returning statements
					// This matches libsql adapter behavior
					lastInsertId: String(result.lastInsertRowid),
				};
			}

			// IMPORTANT: Use stmt.values() instead of stmt.all() to preserve column order
			// When queries have duplicate column names (e.g., SELECT u.id, p.id),
			// stmt.all() returns objects which lose duplicate keys, causing data corruption.
			// stmt.values() returns arrays preserving all columns in order.
			const rowArrays = ((stmt as any).values(...(args as any)) as unknown[][] | null) ?? [];

			// Handle column count mismatch due to duplicate names
			// Only needed for queries with JOINs that have duplicate column names
			// Skip this expensive check for simple queries
			const firstRow = rowArrays[0];
			const actualColumnCount = Math.max(
				declaredTypes.length,
				firstRow ? firstRow.length : 0,
				columnNames.length,
			);

			if (columnNames.length < actualColumnCount) {
				for (let i = columnNames.length; i < actualColumnCount; i++) {
					columnNames.push(`column_${i}`);
				}
			}

			if (declaredTypes.length < actualColumnCount) {
				for (let i = declaredTypes.length; i < actualColumnCount; i++) {
					declaredTypes.push(null);
				}
			}

			// Get column types using inference for computed columns
			// This handles cases where declaredTypes is empty (COUNT, expressions, etc.)
			const columnTypes = getColumnTypes(declaredTypes, rowArrays);

			// If no results, return empty set with column metadata
			if (rowArrays.length === 0) {
				return {
					columnNames,
					columnTypes,
					rows: [],
				};
			}

			// Map rows to Prisma format
			const mappedRows = rowArrays.map((rowArray) => mapRow(rowArray, columnTypes));

			return {
				columnNames,
				columnTypes,
				rows: mappedRows,
				// Don't include lastInsertId for SELECT queries or INSERT with RETURNING
				// as the data is already in the rows
			};
		} catch (error: any) {
			throw new DriverAdapterError(convertDriverError(error));
		}
	}

	/**
	 * Execute a query and return the number of affected rows
	 */
	async executeRaw(query: SqlQuery): Promise<number> {
		const tag = "[js::executeRaw]";
		debug(`${tag} %O`, query);

		try {
			// Always map arguments to match official adapter semantics
			const args = query.args.map((arg, i) => {
				const argType = query.argTypes[i];
				return argType ? mapArg(arg, argType, this.timestampFormat) : arg;
			});

			// Use db.query() which caches compiled statements (vs db.prepare() which recompiles every time)
			const stmt = this.db.query(query.sql);
			const result = stmt.run(...(args as any));
			return result.changes;
		} catch (error: any) {
			throw new DriverAdapterError(convertDriverError(error));
		}
	}
}
