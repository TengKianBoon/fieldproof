# Storage production constraints (recorded 2026-10-27, batch 2)

Constraint source: D15/D18 (Postgres/Blobs requirements). D19 is the
Git-location decision and is unrelated to storage.

Single-host FileStore/FileBlobStore are NOT production atomicity:
- `cas()` re-reads before tmp+rename — correct on one host, racy across hosts.
- Version counters assume one writer process per record version chain.
- Usage counters use a bounded CAS retry loop (25 tries) — fine locally.

Required before any shared/production use:
- Transactional Postgres behind KVStore (row-level `UPDATE ... WHERE version`
  or advisory locks replacing file CAS; `used:*` counters as SQL increments).
- Private Blobs (per-chunk objects + assembled objects, same key scheme)
  replacing FileBlobStore; no database or bucket provisioned until account
  capability/slots are checked (no provisioning in batch builds).
- Isolated preview/production namespaces (separate schemas/buckets).
- No change to the interfaces: KVStore/BlobStore signatures already carry
  what Postgres/Blobs need (versioned CAS, namespaced keys, atomic blobs).
