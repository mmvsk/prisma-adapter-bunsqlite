import { test, expect, describe } from "bun:test";
import { PrismaClient } from "@/prisma-generated/client";
import { PrismaBunSqlite } from "../src/index";
import {
	checkWalMode,
	checkForeignKeys,
	type PrismaClientLike,
} from "../src/sanity-check";

// Setup adapter with foreign keys enabled (default)
const url = process.env.DATABASE_URL!;
const adapter = new PrismaBunSqlite({ url });
const prisma = new PrismaClient({ adapter });

describe("Sanity Check - checkWalMode", () => {
	test("passes when WAL mode is enabled", async () => {
		// Use mock client that returns WAL mode
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(query: string): Promise<T> => {
				if (query === "PRAGMA journal_mode") {
					return [{ journal_mode: "wal" }] as T;
				}
				throw new Error(`Unexpected query: ${query}`);
			},
		};

		// Should not throw
		await checkWalMode(mockClient);
	});

	test("throws when WAL mode is not enabled", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(query: string): Promise<T> => {
				if (query === "PRAGMA journal_mode") {
					return [{ journal_mode: "delete" }] as T;
				}
				throw new Error(`Unexpected query: ${query}`);
			},
		};

		await expect(checkWalMode(mockClient)).rejects.toThrow(
			/SQLite WAL mode is not enabled/
		);
	});

	test("error message includes actual journal_mode value", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(query: string): Promise<T> => {
				if (query === "PRAGMA journal_mode") {
					return [{ journal_mode: "memory" }] as T;
				}
				throw new Error(`Unexpected query: ${query}`);
			},
		};

		try {
			await checkWalMode(mockClient);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			// Should include the actual mode
			expect(message).toContain('got "memory"');
			expect(message).toContain("PRAGMA journal_mode = WAL");
		}
	});
});

describe("Sanity Check - checkForeignKeys", () => {
	test("passes when foreign keys are enabled (default)", async () => {
		// Adapter has foreign keys enabled by default
		await checkForeignKeys(prisma);
	});

	test("throws when foreign keys are disabled", async () => {
		// Create a mock client that simulates foreign_keys = 0
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(query: string): Promise<T> => {
				if (query === "PRAGMA foreign_keys") {
					return [{ foreign_keys: 0n }] as T;
				}
				throw new Error(`Unexpected query: ${query}`);
			},
		};

		await expect(checkForeignKeys(mockClient)).rejects.toThrow(
			/SQLite foreign key constraints are not enabled/
		);
	});

	test("error message includes actual foreign_keys value", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(query: string): Promise<T> => {
				if (query === "PRAGMA foreign_keys") {
					return [{ foreign_keys: 0n }] as T;
				}
				throw new Error(`Unexpected query: ${query}`);
			},
		};

		try {
			await checkForeignKeys(mockClient);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			// Should show 0n
			expect(message).toMatch(/got 0n/);
			expect(message).toContain("PRAGMA foreign_keys = ON");
		}
	});
});

describe("Sanity Check - Error Handling", () => {
	test("throws descriptive error for malformed PRAGMA result (empty array)", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(): Promise<T> => [] as T,
		};

		await expect(checkWalMode(mockClient)).rejects.toThrow(
			/expected array with 1 element/
		);
	});

	test("throws descriptive error for malformed PRAGMA result (not array)", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(): Promise<T> => "not an array" as T,
		};

		await expect(checkWalMode(mockClient)).rejects.toThrow(
			/expected array with 1 element/
		);
	});

	test("throws descriptive error for missing key in result", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(): Promise<T> => [{ wrong_key: "wal" }] as T,
		};

		await expect(checkWalMode(mockClient)).rejects.toThrow(
			/missing key "journal_mode"/
		);
	});

	test("handles bigint foreign_keys value (1n)", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(): Promise<T> => [{ foreign_keys: 1n }] as T,
		};

		// Should not throw - bigint 1n is accepted
		await checkForeignKeys(mockClient);
	});

	test("handles integer foreign_keys value (1)", async () => {
		const mockClient: PrismaClientLike = {
			$queryRawUnsafe: async <T>(): Promise<T> => [{ foreign_keys: 1 }] as T,
		};

		// Should not throw - integer 1 is accepted
		await checkForeignKeys(mockClient);
	});
});
