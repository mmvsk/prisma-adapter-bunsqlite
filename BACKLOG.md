# Development Backlog

This document tracks future improvements, enhancements, and optimizations for `prisma-adapter-bun-sqlite`.

---

## Future Enhancements

### Medium Priority

#### 5. Refactor into Modular Files
**Why**: Better maintainability, easier to review changes

**Proposed structure**:
```
src/
├── index.ts              # Exports
├── adapter.ts            # Main adapter class (200 lines)
├── transaction.ts        # Transaction implementation (80 lines)
├── conversion.ts         # mapRow, mapArg, getColumnTypes (150 lines)
├── errors.ts             # Error mapping & codes (100 lines)
└── types.ts              # Type definitions (50 lines)
```

**Benefits**:
- Easier to find code
- Better separation of concerns
- Easier to test individual modules
- Smaller PR diffs

**Estimated effort**: 4-6 hours

**Status**: Not started - current single-file approach works well for now

---

## v1.0.0 - Production Hardening

### Before 1.0.0 Release

#### 12. Extensive Production Testing
**Requirements**:
- [ ] Used in production by 3+ projects for 3+ months
- [ ] No critical bugs reported
- [ ] Performance verified in real workloads
- [ ] All edge cases documented

---

#### 13. Full API Stability
**Requirements**:
- [ ] No breaking changes planned
- [ ] All deprecations removed
- [ ] API locked for semantic versioning

---

#### 14. Comprehensive Documentation
**Docs to complete**:
- [x] Migration guides (from better-sqlite3, libsql) - in README
- [ ] Troubleshooting guide
- [ ] Performance tuning guide
- [ ] FAQ section
- [ ] Video tutorial (optional)

---

## Future Considerations

### Features Under Consideration

#### 16. Connection Pooling
**Why**: Better performance under high concurrency

**Challenge**: SQLite is single-writer, pooling less beneficial

**Investigation**: Would read replicas help?

**Decision**: Wait for use case

---

#### 17. Encryption Support (SQLCipher)
**Why**: Encrypted database files

**Challenge**: Bun doesn't support SQLCipher natively

**Decision**: Wait for Bun support or user demand

---

## Completed Items

### v0.1.0
- ✅ Initial implementation
- ✅ Comprehensive test suite
- ✅ Documentation
- ✅ npm package setup

### v0.1.1
- ✅ Fix duplicate column data corruption
- ✅ Fix error mapping (errno support)
- ✅ Add LICENSE file
- ✅ Add regression tests

### v0.4.0
- ✅ **#1: Add Debug Logging** - Added comprehensive debug logging matching official adapters
- ✅ **#2: Remove Dead Code** - Removed unused `getColumnTypesForQuery()` method (45 lines)
- ✅ **#3: Base64 BLOB Handling** - Removed unnecessary base64 decoding (Bun returns Uint8Array directly)
- ✅ **#6: Add JSDoc Comments** - Added comprehensive JSDoc to all public API
- ✅ **#9: usePhantomQuery: false** - Changed to match official better-sqlite3 adapter
- ✅ **#15: WAL Configuration** - Added production-ready WAL configuration with advanced options
- ✅ **Enhanced Type Support** - Added UNSIGNED integers, VARCHAR lengths, JSON, CHAR types
- ✅ **13 New Tests** - Comprehensive WAL and type support testing (90 total tests)

### v0.4.5+
- ✅ **#7: TypeScript Strict Mode** - Using `bun tsc --noEmit` for type checking
- ✅ **#8: Column Metadata Safety** - Added `|| []` fallbacks and robust column count handling
- ✅ **#10: Performance Benchmarks** - Separate repo: `benchmark-prisma-sqlite-adapter`
- ✅ **#18: Prisma Integration Tests** - Ported 40 official test scenarios
- ✅ **#19: libsql-style Unit Tests** - Covered via official-scenarios.test.ts
- ✅ **#20: lastInsertId** - Now returned for INSERT/UPDATE/DELETE statements
- ✅ **Reliability Review** - Comprehensive comparison with official Rust engine (quaint)
- ✅ **Always coerce arg types** - Removed fast-path optimization for correctness
- ✅ **useTransaction for migrations** - Properly implemented BEGIN/COMMIT/ROLLBACK
- ✅ **131 Total Tests** - Comprehensive coverage including edge cases from prisma-engines

---

## Decision Log

### Decisions Made

1. ~~**Keep `usePhantomQuery: true`** (v0.1.1)~~ **REVERSED in v0.4.0**
   - **NEW**: Changed to `usePhantomQuery: false` (v0.4.0)
   - Rationale: Matches official @prisma/adapter-better-sqlite3 pattern
   - Simpler implementation with empty commit/rollback methods
   - Prisma engine handles COMMIT/ROLLBACK SQL

2. **Use `stmt.values()` over `stmt.all()`** (v0.1.1)
   - Rationale: Fixes data corruption with duplicate columns
   - No performance impact observed

3. **Support errno-based errors** (v0.1.1)
   - Rationale: Bun doesn't always set `.code`, need `.errno` fallback
   - Required for proper error handling

4. **Default `safeIntegers: true`** (v0.1.0)
   - Rationale: Prevent silent data corruption for large integers
   - Users can opt-out if needed

5. **Remove Base64 BLOB handling** (v0.4.0)
   - Rationale: Bun always returns BLOBs as Uint8Array, never as base64 strings
   - Removed 12 lines of unnecessary code

6. **WAL disabled by default** (v0.4.0)
   - Rationale: Opt-in approach better for default behavior
   - Production users can enable with custom configuration
   - Prevents unexpected behavior changes

7. **No schema caching** (v0.4.5)
   - Rationale: We use `stmt.declaredTypes` not PRAGMA queries
   - Caching could cause issues with migrations/schema changes
   - Simplicity over premature optimization

8. **Keep `BEGIN` (not `BEGIN IMMEDIATE`)** (v0.4.5)
   - Rationale: Matches better-sqlite3 adapter
   - Our AsyncMutex already serializes transactions
   - `BEGIN IMMEDIATE` only helps with multiple connections (we have one)

9. **Keep ISO8601 as default timestamp format** (v0.4.5)
   - Rationale: Matches better-sqlite3, human-readable, works with SQLite date functions
   - Official Rust engine uses `unixepoch-ms` but that's less user-friendly
   - Users can opt into `unixepoch-ms` if needed

10. **Keep defensive PRAGMA defaults** (v0.4.5)
    - `foreign_keys=ON` and `busy_timeout=5000` even though official adapters don't set these
    - Rationale: More production-ready out of the box
    - Prisma schemas expect FK constraints to work

11. **Always coerce argument types** (v0.4.5)
    - Removed "fast path" that skipped mapArg for non-datetime/bytes/boolean types
    - Rationale: Ensures strings are properly converted to int/decimal/bigint
    - Correctness over micro-optimization

---

## Review Schedule

- **Monthly**: Review backlog priorities
- **Quarterly**: Re-assess roadmap based on user feedback
- **After major release**: Collect feedback, update backlog

---

## Contributing

Want to help? Pick an item from the backlog!

1. Comment on the issue (create one if needed)
2. Fork the repo
3. Make changes with tests
4. Submit PR referencing the backlog item

See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation details and reliability review findings.

---

## Questions?

- Issues: https://github.com/mmvsk/prisma-adapter-bun-sqlite/issues
- Discussions: https://github.com/mmvsk/prisma-adapter-bun-sqlite/discussions

---

**Last updated**: v0.4.5 (Reliability Review & Official Test Suite)
**Next review**: After first production deployments
