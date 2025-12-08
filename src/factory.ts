/**
 * Prisma driver adapter factory for Bun's native SQLite
 */

import { Database } from "bun:sqlite";
import {
	DriverAdapterError,
	type SqlDriverAdapter,
	type SqlMigrationAwareDriverAdapterFactory,
} from "@prisma/driver-adapter-utils";

import type { PrismaBunSqliteConfig, WalConfiguration } from "./types.js";
import { ADAPTER_NAME } from "./queryable.js";
import { BunSqliteAdapter } from "./adapter.js";

/**
 * Prisma driver adapter factory for Bun's native SQLite (`bun:sqlite`).
 *
 * This is the main entry point for using the adapter with Prisma Client.
 * Implements `SqlMigrationAwareDriverAdapterFactory` for full migration support.
 *
 * @example Basic usage
 * ```typescript
 * import { PrismaClient } from "@prisma/client";
 * import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
 *
 * const adapter = new PrismaBunSqlite({ url: "file:./dev.db" });
 * const prisma = new PrismaClient({ adapter });
 *
 * const users = await prisma.user.findMany();
 * ```
 *
 * @example With WAL mode
 * ```typescript
 * const adapter = new PrismaBunSqlite({
 *   url: "file:./dev.db",
 *   wal: {
 *     enabled: true,
 *     synchronous: "NORMAL",
 *     walAutocheckpoint: 2000
 *   }
 * });
 * ```
 *
 * @see https://github.com/mmvsk/prisma-adapter-bun-sqlite
 */
export class PrismaBunSqlite implements SqlMigrationAwareDriverAdapterFactory {
	readonly provider = "sqlite" as const;
	readonly adapterName = ADAPTER_NAME;

	private config: PrismaBunSqliteConfig;

	constructor(config: PrismaBunSqliteConfig) {
		this.validateConfig(config);
		this.config = config;
	}

	/**
	 * Validate configuration options
	 */
	private validateConfig(config: PrismaBunSqliteConfig): void {
		// When using unixepoch-ms with safeIntegers (default), require explicit acknowledgment
		// of DateTime aggregate limitation. Three valid workarounds:
		// 1. safeIntegers: false - no BigInts, but potential precision loss
		// 2. allowBigIntToNumberConversion: true - converts timestamp-range BigInts to numbers
		// 3. allowUnsafeDateTimeAggregates: true - accepts Invalid Date for aggregates
		if (config.timestampFormat === "unixepoch-ms" && config.safeIntegers !== false) {
			const hasConversionOption = config.allowBigIntToNumberConversion === true;
			const hasUnsafeOption = config.allowUnsafeDateTimeAggregates === true;

			if (!hasConversionOption && !hasUnsafeOption) {
				throw new Error(
					`timestampFormat "unixepoch-ms" requires explicit acknowledgment of a DateTime aggregate limitation. ` +
						`Choose one of the following options:\n` +
						`  - safeIntegers: false                   → No BigInts (ensure your integers stay within JS safe range)\n` +
						`  - allowBigIntToNumberConversion: true   → Converts timestamp-range BigInts to numbers\n` +
						`  - allowUnsafeDateTimeAggregates: true   → Accepts that DateTime aggregates (_min, _max) return Invalid Date\n\n` +
						`See documentation for details: https://github.com/mmvsk/prisma-adapter-bun-sqlite#timestamp-format`,
				);
			}

			if (hasConversionOption && hasUnsafeOption) {
				throw new Error(
					`Cannot set both allowBigIntToNumberConversion and allowUnsafeDateTimeAggregates. Choose one:\n` +
						`  - allowBigIntToNumberConversion: true  → Fixes DateTime aggregates\n` +
						`  - allowUnsafeDateTimeAggregates: true  → Accepts limitation`,
				);
			}
		}

		// These options are only meaningful with unixepoch-ms + safeIntegers
		if (config.timestampFormat !== "unixepoch-ms" || config.safeIntegers === false) {
			if (config.allowBigIntToNumberConversion !== undefined) {
				throw new Error(
					`allowBigIntToNumberConversion is only applicable when timestampFormat is "unixepoch-ms" with safeIntegers enabled`,
				);
			}
			if (config.allowUnsafeDateTimeAggregates !== undefined) {
				throw new Error(
					`allowUnsafeDateTimeAggregates is only applicable when timestampFormat is "unixepoch-ms" with safeIntegers enabled`,
				);
			}
		}
	}

	/**
	 * Create database connection with standard configuration
	 */
	private createConnection(url: string): Database {
		// Parse URL - support both "file:./path" and "./path" formats
		const dbPath = url.replace(/^file:/, "");

		// Enable safe integers by default to prevent precision loss for BIGINT values
		const safeIntegers = this.config.safeIntegers !== false;
		const db = new Database(dbPath, { safeIntegers });

		// Enable foreign key constraints (required for cascading deletes)
		db.run("PRAGMA foreign_keys = ON");

		// Configure WAL mode if specified (only for file-based databases)
		if (dbPath !== ":memory:") {
			this.configureWalMode(db);
		}

		return db;
	}

	/**
	 * Configure WAL (Write-Ahead Logging) mode
	 * Only applies to file-based databases
	 */
	private configureWalMode(db: Database): void {
		const walConfig = this.config.wal;

		// If wal not specified or explicitly disabled, skip WAL configuration
		if (!walConfig) {
			// Set default busy timeout even without WAL
			db.run("PRAGMA busy_timeout = 5000");
			return;
		}

		// Normalize config: boolean true -> {enabled: true}, object -> as-is
		const config: WalConfiguration =
			typeof walConfig === "boolean" ? { enabled: walConfig } : walConfig;

		// If explicitly disabled, skip
		if (!config.enabled) {
			// Set default busy timeout even without WAL
			db.run("PRAGMA busy_timeout = 5000");
			return;
		}

		// Enable WAL mode
		try {
			const result = db.prepare("PRAGMA journal_mode = WAL").get() as
				| { journal_mode: string }
				| undefined;
			const currentMode = result?.journal_mode?.toLowerCase();

			// Check if WAL was successfully enabled
			if (currentMode !== "wal") {
				throw new Error(`Failed to enable WAL mode. Current mode: ${currentMode || "unknown"}`);
			}
		} catch (error: any) {
			throw new DriverAdapterError({
				kind: "GenericJs",
				id: 0,
				originalMessage: `Failed to enable WAL mode: ${error.message}`,
			});
		}

		// Configure synchronous mode if specified (with validation)
		if (config.synchronous) {
			const validModes = ["OFF", "NORMAL", "FULL", "EXTRA"] as const;
			if (!validModes.includes(config.synchronous)) {
				throw new DriverAdapterError({
					kind: "GenericJs",
					id: 0,
					originalMessage: `Invalid synchronous mode: ${config.synchronous}. Valid modes: ${validModes.join(", ")}`,
				});
			}
			db.run(`PRAGMA synchronous = ${config.synchronous}`);
		}

		// Configure WAL autocheckpoint if specified (with validation)
		if (config.walAutocheckpoint !== undefined) {
			const checkpoint = Number(config.walAutocheckpoint);
			if (!Number.isInteger(checkpoint) || checkpoint < 0) {
				throw new DriverAdapterError({
					kind: "GenericJs",
					id: 0,
					originalMessage: `Invalid walAutocheckpoint: ${config.walAutocheckpoint}. Must be a non-negative integer.`,
				});
			}
			db.run(`PRAGMA wal_autocheckpoint = ${checkpoint}`);
		}

		// Configure busy timeout (use specified value or default 5000ms, with validation)
		const busyTimeout = config.busyTimeout ?? 5000;
		const timeout = Number(busyTimeout);
		if (!Number.isInteger(timeout) || timeout < 0) {
			throw new DriverAdapterError({
				kind: "GenericJs",
				id: 0,
				originalMessage: `Invalid busyTimeout: ${busyTimeout}. Must be a non-negative integer.`,
			});
		}
		db.run(`PRAGMA busy_timeout = ${timeout}`);
	}

	/**
	 * Connect to the main database
	 */
	async connect(): Promise<SqlDriverAdapter> {
		const db = this.createConnection(this.config.url);
		return new BunSqliteAdapter(db, this.config);
	}

	/**
	 * Connect to the shadow database for migrations
	 * Shadow database is used by Prisma Migrate for migration testing and diffing.
	 * Defaults to :memory: if shadowDatabaseUrl is not specified.
	 */
	async connectToShadowDb(): Promise<SqlDriverAdapter> {
		// Use :memory: by default for shadow database (faster and isolated)
		const shadowUrl = this.config.shadowDatabaseUrl ?? ":memory:";
		const db = this.createConnection(shadowUrl);
		return new BunSqliteAdapter(db, this.config);
	}
}
