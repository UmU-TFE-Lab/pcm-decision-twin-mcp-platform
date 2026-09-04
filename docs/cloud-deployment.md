# Cloud Deployment Boundary

The repository is cloud-ready, but it is not evidence of a deployed public multi-tenant service.

## Target Runtime

```text
Browser
  -> Vercel or Netlify frontend
  -> FastAPI application API
  -> PostgreSQL or Supabase lifecycle database
  -> S3-compatible dataset/report storage
  -> PCM similarity model service
  -> HTTP/SSE MCP Gateway -> persistent MCP stdio server
```

## Implemented Locally

- React/Vite frontend and production build.
- FastAPI login, dataset, project, version, scenario, prediction, report, and MCP-log endpoints.
- SQLAlchemy lifecycle schema tested with SQLite.
- PostgreSQL/Supabase DDL for the same lifecycle entities.
- S3-compatible upload adapter.
- Separate model service with weighted similarity prediction, empirical ranges, data-support scores, and evidence records.
- MCP Gateway with asynchronous runs, SSE progress, cancellation, run hash, and local JSON audit.
- Automated Node, service, MCP/Gateway, and desktop/mobile browser tests.

The Agent Lab currently persists its Gateway trace to local JSON. Wiring Gateway runs to the authenticated project API is a production integration task.

## Local Services

```bash
cp .env.example .env
# Replace every placeholder secret before starting the stack.
docker compose up --build
```

```text
Frontend dev server: http://127.0.0.1:5173
Backend API:         http://127.0.0.1:8000
Model service:       http://127.0.0.1:9002
MCP Gateway:         http://127.0.0.1:8787
MinIO console:       http://127.0.0.1:9001
PostgreSQL:          localhost:5432
```

The lightweight web and MCP deployment profile has been exercised on SSC. Validate the full multi-service compose profile in the target environment before relying on it.

## Frontend Hosting

Build command: `npm run build`. Output directory: `dist`.

Set:

```text
VITE_API_BASE_URL=https://your-api-domain
VITE_MCP_GATEWAY_URL=https://your-mcp-gateway-domain
```

## Required Service Configuration

```text
DATABASE_URL
JWT_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
CORS_ORIGINS
S3_ENDPOINT_URL
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
MODEL_SERVICE_URL
MCP_GATEWAY_CORS_ORIGINS
PCM_DATASET_PATH
```

The built-in single-admin HMAC token is suitable only for a protected research prototype. Replace it with Supabase Auth, institutional SSO, or another production identity provider.

## Production Gates

- Apply and test database migrations and row-level security.
- Connect Gateway run records to authenticated projects and users.
- Enforce tool-level permissions, rate limits, request limits, and job quotas.
- Store datasets and reports in private object storage with retention policy.
- Add secrets management, TLS, backups, recovery drills, and dependency scanning.
- Test concurrent users, sustained workloads, cloud-region latency, and failure recovery.
- Add adversarial MCP/tool-misuse tests and audit-log integrity monitoring.
