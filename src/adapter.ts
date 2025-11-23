/**
 * Main BunSqlite adapter class
 */

import { Database } from "bun:sqlite";
import {
	DriverAdapterError,
	type IsolationLevel,
	type SqlDriverAdapter,
	type Transaction,
	type TransactionOptions,
} from "@prisma/driver-adapter-utils";

import type { PrismaBunSqliteOptions } from "./types.js";
import { convertDriverError } from "./errors.js";
import { BunSqliteQueryable, debug } from "./queryable.js";
import { AsyncMutex, BunSqliteTransaction } from "./transaction.js";

/**
 * Main BunSqlite adapter class
 */
export class BunSqliteAdapter extends BunSqliteQueryable implements SqlDriverAdapter {
	private transactionMutex = new AsyncMutex();

	constructor(db: Database, adapterOptions?: PrismaBunSqliteOptions) {
		super(db, adapterOptions);
	}

	/**
	 * Execute multiple SQL statements (for migrations)
	 */
	async executeScript(script: string): Promise<void> {
		try {
			// Use native exec() which properly handles multiple statements
			this.db.exec(script);
		} catch (error: any) {
			throw new DriverAdapterError(convertDriverError(error));
		}
	}

	/**
	 * Start a new transaction
	 * Transactions are automatically serialized via mutex - concurrent calls will wait
	 *
	 * Uses usePhantomQuery: false (like official better-sqlite3 adapter)
	 * This means Prisma engine sends COMMIT/ROLLBACK through executeRaw()
	 */
	async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
		const tag = "[js::startTransaction]";
		const options: TransactionOptions = {
			usePhantomQuery: false,
		};
		debug(`${tag} options: %O`, options);

		// SQLite only supports SERIALIZABLE isolation level
		if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
			throw new DriverAdapterError({
				kind: "InvalidIsolationLevel",
				level: isolationLevel,
			});
		}

		// Acquire mutex lock - this will wait if another transaction is active
		const releaseLock = await this.transactionMutex.acquire();

		try {
			// Begin transaction
			this.db.run("BEGIN");

			return new BunSqliteTransaction(this.db, options, this.adapterOptions, releaseLock);
		} catch (error: any) {
			// Release lock on error
			releaseLock();
			throw new DriverAdapterError(convertDriverError(error));
		}
	}

	/**
	 * Dispose of the adapter and close the database
	 */
	async dispose(): Promise<void> {
		this.db.close();
	}

	/**
	 * Get connection info (optional)
	 */
	getConnectionInfo() {
		return {
			maxBindValues: 999, // SQLite default limit
			supportsRelationJoins: true,
		};
	}
}

/**
 * Factory function to create a BunSqlite adapter
 */
export function createBunSqliteAdapter(db: Database): SqlDriverAdapter {
	return new BunSqliteAdapter(db);
}
