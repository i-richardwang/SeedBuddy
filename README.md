# VitroFlow

VitroFlow turns repeated plant tissue culture photographs into comparable readings and reviewed detector training data. Treatments define conditions, units provide independent replicates, and observations follow those units over time with a model and counted classes for each day.

## Parts

- The Web control plane owns experiments, datasets, annotation review, model versions and training runs.
- `vitroctl` is the source-installed operator CLI and native Worker runtime for dataset transfer, detection and training.
- `vitroflow` is the published Python package for sorting dish photographs and reviewing focus and countability before upload.

## Development

Requirements are Python 3.11+, [uv](https://docs.astral.sh/uv/), Bun 1.4.0 and Docker.

```bash
uv sync --all-extras --group dev --locked
cd web && bun install --frozen-lockfile && cd ..
cp .env.example .env
cp web/.env.example web/.env
```

Fill in the shared authentication entries in `.env` and copy that block into `web/.env`. Use `http://localhost:3000` as the development origin. Compose reads the root environment when starting storage. Start storage and the workbench:

```bash
docker compose up -d postgres rustfs
docker compose run --rm bucket
cd web
bun run dev
```

Sign in with the administrator credentials configured there. Account behavior is described in [Accounts](docs/accounts.md); Worker installation is in [vitroctl](docs/vitroctl.md#install).

## Deployment

For Compose, create the environment, replace the example storage credentials and fill in the authentication entries:

```bash
cp .env.example .env
docker compose up --build -d
```

Compose runs the workbench, maintenance, Postgres, RustFS and a one-shot bucket initializer. The workbench is exposed on port 3000, RustFS on 9000 and its console on 9001. Services restart unless stopped. The three image variables accept immutable mirror references.

[zeabur-template.yaml](zeabur-template.yaml) deploys the application roles with PostgreSQL and MinIO; its deployment form and service instructions define domain binding and storage setup. MinIO creates the bucket in its start command. Workers run outside the hosting platform.

Workbench and maintenance use the same source commit or image digest and storage environment. Maintenance has no public port. See [Images](docs/images.md#maintenance) for its analysis policy.

## Verification

The default suite uses PGlite and in-memory blobs without external services. Web tests can run directly with `cd web && bun test`; their preload compiles missing or stale messages. Run the complete deterministic gate from the repository root:

```bash
make check
```

It runs `make check-python` (the architecture check, Ruff lint and format check, Pyright and pytest) and `make check-web` (the production build, the architecture, contract and Prettier checks, Biome lint, TypeScript and the Web tests).

Build the pinned production image:

```bash
make check-image
```

The reference-image regression suite uses the checksum manifest in `tests/fixtures/reference-images.json`. Point it at the matching private corpus:

```bash
make check-reference REFERENCE_IMAGE_DIR=/absolute/path/to/reference-images
```

Run the constraints and contended writes that need a real PostgreSQL server:

```bash
export VITROFLOW_TEST_DATABASE_URL=postgres://vitroflow:vitroflow@localhost:5432/vitroflow_test

make check-postgres
```

Run the BlobStore contract against an actual S3-compatible endpoint:

```bash
export AWS_ACCESS_KEY_ID=vitroflow
export AWS_SECRET_ACCESS_KEY=vitroflow
export AWS_REGION=us-east-1
export VITROFLOW_TEST_S3_ENDPOINT=http://localhost:9000
export VITROFLOW_TEST_S3_BUCKET=vitroflow

make check-s3
```

## Documentation

- [Accounts](docs/accounts.md) — sign-in, administration and integrations.
- [Records, models and datasets](docs/domain.md) — experimental design, model lifecycle and dataset transfer.
- [Readings](docs/readings.md) — counts, exclusions, summaries and spreadsheet semantics.
- [vitroctl](docs/vitroctl.md) — source installation, Workers, local training and model delivery.
- [vitroflow](packages/vitroflow/README.md) — photograph sorting and review.
- [Agent API](docs/agent-api.md) — HTTP and MCP access to application operations.
- [AI annotation](docs/ai-annotation.md) — regional annotation tools and proposal acceptance.
- [Annotator prompt](docs/ai-annotation-prompts/annotator.md) — one image's regional annotation batch.
- [Coordinator prompt](docs/ai-annotation-prompts/coordinator.md) — dispatch and continuation of annotation batches.
- [Architecture](docs/architecture.md) — source boundaries, contracts and annotation lifetime.
- [Backend architecture](docs/backend-architecture.md) — service ownership, execution and persistence.
- [Images](docs/images.md) — canonical pixels, dish analysis and maintenance.
- [Interface](docs/interface.md) — UI components, page composition and interaction rules.

VitroFlow is licensed under the [MIT License](LICENSE).
