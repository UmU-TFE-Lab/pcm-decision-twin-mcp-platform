# MCP Integration

The research prototype exposes the PCM decision twin through a Model Context Protocol server and a browser-facing HTTP/SSE gateway.

## Runtime Path

```text
Agent Lab -> HTTP/SSE Gateway -> persistent MCP stdio client
          -> MCP server -> shared analytical kernel -> fixed PCM dataset
```

The Agent Lab displays the real MCP trace and report hash. If the gateway cannot be reached, it runs the shared local workflow and labels the result `LOCAL FALLBACK`; the fallback is not presented as an MCP transport call.

## Start

Full frontend and Gateway runtime:

```bash
npm run dev:full
```

MCP stdio server only:

```bash
npm run mcp
```

Gateway only:

```bash
npm run gateway
```

Override the dataset path when needed:

```bash
PCM_DATASET_PATH=/absolute/path/to/pcm_thermal_storage.csv npm run mcp
```

## Registry

Release `v0.2.0-research-prototype` exposes 18 tools, 4 resources, and 3 prompts.

### Tools

| Group | Tools |
|---|---|
| Dataset and schema | `get_summary`, `describe_inputs`, `get_default_scenario`, `filter_records`, `compare_groups` |
| State and evidence | `predict_twin_state`, `validate_scenario`, `explain_prediction` |
| Analysis and decision support | `run_sensitivity_analysis`, `run_what_if`, `evaluate_candidates`, `optimize_pcm_design`, `recommend_design`, `get_operating_windows` |
| Workflow and reporting | `diagnose_and_recommend`, `generate_report`, `generate_decision_package`, `get_mcp_benchmark` |

### Resources

- `pcm://dataset/summary`
- `pcm://dataset/schema`
- `pcm://guide/agent-workflows`
- `pcm://mcp/benchmark`

### Prompts

- `pcm_design_review`
- `pcm_diagnostic_report`
- `pcm_agent_workflow_benchmark`

## Gateway API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Gateway status and MCP transport type |
| `GET` | `/api/v1/mcp/capabilities` | Live tool/resource/prompt registry |
| `POST` | `/api/v1/agent/runs` | Queue a complete MCP decision workflow |
| `GET` | `/api/v1/agent/runs/:id` | Retrieve current or completed run |
| `GET` | `/api/v1/agent/runs/:id/events` | Stream progress and tool-call state over SSE |
| `POST` | `/api/v1/agent/runs/:id/cancel` | Cancel a queued or running workflow |

Completed runs are written locally to `.runtime/mcp-runs/` as audit JSON. Production deployment should replace this research storage with authenticated, database-backed lifecycle records.

## Direct Client Configuration

```json
{
  "mcpServers": {
    "pcm-decision-twin": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/pcm_decision_twin_platform",
      "env": {
        "PCM_DATASET_PATH": "/absolute/path/to/pcm_decision_twin_platform/pcm_thermal_storage.csv"
      }
    }
  }
}
```

## Benchmark

```bash
npm run mcp:benchmark
```

The benchmark writes `benchmarks/results/mcp-agent-benchmark-latest.json` and evaluates discovery, task completion, malformed-input rejection, fallback behavior, warning correctness, evidence completeness and ordering, recommendation stability, rule-based expected-output agreement, report reproducibility, and latency.

`fallback_correctness` means that unsupported categories are detected and context-supported evidence is not claimed. It does not validate the physical accuracy of a fallback prediction.
