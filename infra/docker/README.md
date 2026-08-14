# Docker development stack

`docker-compose.yml` provides the local backing services:

- **PostgreSQL 16** (database)
- **Redis 7** (cache / queues)
- **MinIO** (S3-compatible object storage)

```bash
# from the repo root
docker compose --env-file .env -f infra/docker/docker-compose.yml up
```

## MinIO note

MinIO's community edition shifted to a source-only distribution (October 2025)
and moved to the AGPL license. The dev stack pins a stable release from before
that shift (`RELEASE.2025-04-22T22-12-26Z`). The production object-storage
provider is chosen in the backup/storage phase; treat MinIO here as a local
S3-compatible stand-in only.
