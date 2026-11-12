.PHONY: check check-python check-web check-image check-reference check-postgres check-s3

check: check-python check-web

check-python:
	uv run python scripts/check_architecture.py
	uv run ruff check src tests scripts packages
	uv run ruff format --check src tests scripts packages
	uv run pyright
	uv run pytest

# The build comes first: it generates the route tree and the compiled messages
# that the type check and the tests import.
check-web:
	cd web && bun run build
	cd web && bun run architecture:check
	cd web && bun run contracts:check
	cd web && bun run format:check
	cd web && bun run lint
	cd web && bunx tsc --noEmit
	cd web && bun test

check-image:
	docker build --file Dockerfile.web --tag seedbuddy-web:check .

check-reference:
	@test -n "$(REFERENCE_IMAGE_DIR)" || (echo "Set REFERENCE_IMAGE_DIR to the reference image directory" >&2; exit 2)
	SEEDBUDDY_REFERENCE_IMAGE_DIR="$(REFERENCE_IMAGE_DIR)" uv run pytest --override-ini addopts='' -m reference tests/test_regression.py

check-postgres:
	@test -n "$(SEEDBUDDY_TEST_DATABASE_URL)" || (echo "Set SEEDBUDDY_TEST_DATABASE_URL" >&2; exit 2)
	cd web && bun test src/server/infra/db/schema.test.ts src/server/models/registry.test.ts src/server/images/analysis-maintenance.test.ts

check-s3:
	@test -n "$(SEEDBUDDY_TEST_S3_ENDPOINT)" || (echo "Set SEEDBUDDY_TEST_S3_ENDPOINT" >&2; exit 2)
	@test -n "$(SEEDBUDDY_TEST_S3_BUCKET)" || (echo "Set SEEDBUDDY_TEST_S3_BUCKET" >&2; exit 2)
	cd web && SEEDBUDDY_REQUIRE_S3_CONTRACT=1 bun test src/server/infra/blobs/store.test.ts
