/**
 * SQLite database sanity checks for Prisma
 *
 * Validates that critical SQLite configuration is properly set.
 * Use these checks at application startup to catch configuration issues early.
 *
 * @example
 * ```typescript
 * import { checkWalMode, checkForeignKeys } from "prisma-adapter-bun-sqlite/sanity-check";
 *
 * await checkWalMode(prisma);
 * await checkForeignKeys(prisma);
 * ```
 */

/**
 * Minimal interface for a Prisma client with raw query capability
 */
export interface PrismaClientLike {
	$queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/**
 * Result of a PRAGMA query
 */
type PragmaResult<K extends string, V> = Array<{ [key in K]: V }>;

/**
 * Query a PRAGMA setting and return its value
 */
async function getPragmaValue<K extends string>(
	client: PrismaClientLike,
	key: K
): Promise<unknown> {
	const result = await client.$queryRawUnsafe<PragmaResult<K, unknown>>(
		`PRAGMA ${key}`
	);

	if (!Array.isArray(result) || result.length !== 1) {
		throw new Error(
			`Unexpected PRAGMA ${key} result: expected array with 1 element, got ${JSON.stringify(result)}`
		);
	}

	const row = result[0];
	if (typeof row !== "object" || row === null || !(key in row)) {
		throw new Error(
			`Unexpected PRAGMA ${key} result: missing key "${key}" in ${JSON.stringify(row)}`
		);
	}

	return row[key];
}

/**
 * Check that WAL (Write-Ahead Logging) mode is enabled.
 *
 * WAL mode provides better concurrency and performance for most workloads.
 * It must be enabled on the database file itself, not just per-connection.
 *
 * @throws Error if journal_mode is not "wal"
 *
 * @example
 * ```typescript
 * import { checkWalMode } from "prisma-adapter-bun-sqlite/sanity-check";
 *
 * // At application startup
 * await checkWalMode(prisma);
 * ```
 */
export async function checkWalMode(client: PrismaClientLike): Promise<void> {
	const value = await getPragmaValue(client, "journal_mode");

	if (value !== "wal") {
		throw new Error(
			`SQLite WAL mode is not enabled. ` +
				`Expected journal_mode = "wal", got "${value}". ` +
				`Enable WAL mode by running: PRAGMA journal_mode = WAL;`
		);
	}
}

/**
 * Check that foreign key constraints are enabled.
 *
 * SQLite disables foreign key enforcement by default. This must be enabled
 * per-connection for referential integrity to be enforced.
 *
 * Note: If using PrismaBunSqlite adapter, foreign keys are enabled by default.
 *
 * @throws Error if foreign_keys is not enabled (1 or 1n)
 *
 * @example
 * ```typescript
 * import { checkForeignKeys } from "prisma-adapter-bun-sqlite/sanity-check";
 *
 * // At application startup
 * await checkForeignKeys(prisma);
 * ```
 */
export async function checkForeignKeys(client: PrismaClientLike): Promise<void> {
	const value = await getPragmaValue(client, "foreign_keys");

	// SQLite returns 0/1 as integer or bigint depending on driver
	const isEnabled = value === 1 || value === 1n;

	if (!isEnabled) {
		throw new Error(
			`SQLite foreign key constraints are not enabled. ` +
				`Expected foreign_keys = 1, got ${typeof value === "bigint" ? `${value}n` : JSON.stringify(value)}. ` +
				`Enable foreign keys by running: PRAGMA foreign_keys = ON;`
		);
	}
}
