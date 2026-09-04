# PCM Decision-Twin MCP Platform

Open-source software for evidence-grounded phase-change-material (PCM) scenario analysis. The platform combines a React interface, a similarity-based state estimator, validity and evidence checks, an MCP server, and an HTTP/SSE gateway for tool-based agent access.

The current implementation is an offline decision-support prototype. It does not provide live sensor synchronization, online state assimilation, actuation, or closed-loop control.

## Features

- Scenario definition and schema validation for PCM thermal-storage applications.
- Evidence-grounded state estimation with nearby-record retrieval.
- Range, category, support, fallback, and saturation diagnostics.
- What-if analysis, sensitivity analysis, candidate comparison, and constrained ranking.
- Reproducible report generation with an audit hash.
- Browser Agent Lab backed by a real MCP workflow through an HTTP/SSE gateway.
- MCP registry containing 18 tools, 4 resources, and 3 prompts.
- Unit, integration, service, protocol-benchmark, and browser tests.

## Repository Layout

- `src/`: React application, analytical kernel, Agent Lab workflow, and Gateway client.
- `mcp_server/`: MCP tools, resources, prompts, smoke test, and protocol benchmark.
- `mcp_gateway/`: HTTP/SSE bridge to a persistent MCP stdio client.
- `backend/`: lifecycle API and local persistence service.
- `model_service/`: similarity-estimator service.
- `tests/`: unit, integration, and Playwright tests.
- `data/`: input field dictionary, validation schema, and configuration metadata.
- `scripts/`: local orchestration, dataset validation, and runtime benchmarking.
- `deploy/` and `compose.ssc*.yml`: container and SSC deployment definitions.
- `public/assets/`: static assets required by the web interface.

Datasets, generated analysis outputs, credentials, local databases, dependency directories, build products, and runtime logs are not included.

## Requirements

- Node.js 20.19 or newer
- npm
- Python 3.12 for the optional API and model-service tests
- Docker and Docker Compose for container deployment

## Dataset Setup

The dataset is not distributed in this code-only repository. A compatible file must follow `data/dataset_schema.json` and use the filename `pcm_thermal_storage.csv`.

For the canonical research dataset, stage the file with checksum verification:

```bash
npm ci
npm run data:stage -- /absolute/path/to/pcm_thermal_storage.csv
```

This writes the root copy used by Node.js and services and the `public/` copy used by the browser application. Both generated copies are ignored by Git.

## Run Locally

Start the frontend and MCP Gateway together:

```bash
npm run dev:full
```

Open `http://127.0.0.1:5173`. The Gateway listens on `http://127.0.0.1:8787` and maintains the MCP stdio client used by Agent Lab.

To run only the frontend with its explicitly labelled local fallback:

```bash
npm run dev
```

## MCP Access

Run the stdio server directly:

```bash
npm run mcp
```

Run the HTTP/SSE Gateway:

```bash
npm run gateway
```

Tool schemas and client examples are documented in `docs/mcp-integration.md`.

## Validation and Tests

For code-level checks without the canonical dataset, generate the deterministic software-test fixture first:

```bash
npm run test:fixture
npm run build
npm test
npm run mcp:smoke
npm run test:e2e
```

The generated fixture exists only to exercise software paths. It is not experimental, simulation, or research evidence and must not be used to report model performance. After staging the canonical dataset, `npm run data:validate`, `npm run mcp:benchmark`, and `npm run platform:performance` run the data-dependent validation workflows.

Python service tests require a local environment:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
npm run test:services
```

Generated validation and benchmark results are written locally and ignored by Git.

## Deployment

- `docs/ssc-minimal-deployment.md` describes a private deployment exposed through an SSH tunnel.
- `docs/ssc-public-deployment.md` describes the public HTTPS profile with a same-origin Gateway proxy.
- `docs/cloud-deployment.md` describes the broader service architecture.

A running research deployment is available at [pcm.130-238-27-71.sslip.io](https://pcm.130-238-27-71.sslip.io/). Availability is not guaranteed.

## Scope and Safety

The model outputs are associative scenario estimates and decision-support indicators. They are not control commands, calibrated probabilities, or evidence of operational performance in a deployed PCM system. Unsupported categories and weak-support scenarios must be interpreted through the returned validity and fallback indicators.

Do not expose the development Docker credentials or an unauthenticated Gateway on an untrusted network. Production use requires managed secrets, authenticated access, tenant isolation, persistent audit storage, monitoring, backups, and security testing.

## License

This project is released under the [MIT License](LICENSE).
