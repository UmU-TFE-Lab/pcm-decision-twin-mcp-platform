import React, { useEffect, useMemo, useState } from "react";
import {
  adaptationMatrix,
  bestOperatingWindows,
  categories,
  buildRanges,
  buildReport,
  comparePredictions,
  diagnosticRecommendations,
  dataQuality,
  defaultScenario,
  diagnostics,
  filterRows,
  groupBy,
  healthIndex,
  hourlyProfile,
  predictBySimilarity,
  recommend,
  round,
  summarize,
} from "./analytics.js";
import {
  MCP_WORKFLOW_STEPS,
  FAILURE_MODES,
  SCENARIO_TEMPLATES,
  buildCounterfactualRecommendations,
  buildEvidenceCluster,
  buildMarkdownReport,
  buildDecisionTrace,
  buildToolCallPreview,
  compareFallbackPrediction,
  compareTwinModels,
  decomposeScenarioQuality,
  explainPrediction,
  explainUncertainty,
  generateDecisionPackage as generateAgentDecisionPackage,
  mcpBenchmark,
  optimizePcmDesign,
  parseAgentTask,
  runConstraintAwareOptimization,
  runSensitivityAnalysis,
  runMultiVariableSensitivity,
  validateScenario,
} from "./agentWorkflow.js";
import { API_BASE_URL, checkApiHealth } from "./cloudApi.js";
import { labelMap, loadPcmData, MODEL_INPUTS } from "./data.js";
import {
  checkMcpGateway,
  MCP_GATEWAY_URL,
  runAgentWorkflowViaGateway,
} from "./mcpGateway.js";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "explorer", label: "Explorer" },
  { id: "compare", label: "Compare" },
  { id: "twin", label: "Twin Lab" },
  { id: "forecast", label: "Operating profile" },
  { id: "whatif", label: "What-if" },
  { id: "recommend", label: "Recommend" },
  { id: "report", label: "Report" },
  { id: "cloud", label: "Cloud" },
  { id: "mcp", label: "Agent API" },
  { id: "guide", label: "Guide" },
  { id: "agent", label: "Agent Lab", featured: true },
];

const agentRunSteps = [
  ["validate_scenario", "Checking scenario support and extrapolation risk"],
  ["explain_prediction", "Computing prediction evidence, weights, and fallback comparison"],
  ["run_sensitivity_analysis", "Scanning the selected operating variable"],
  ["optimize_pcm_design", "Ranking PCM design candidates"],
  ["generate_decision_package", "Preparing the auditable decision package"],
  ["multi_variable_sensitivity", "Comparing multiple physical drivers"],
  ["constraint_filter", "Applying optimization constraints"],
  ["counterfactual_recommendation", "Searching counterfactual operating changes"],
  ["benchmark_update", "Updating MCP benchmark and local run history"],
];

const sliderConfig = [
  "air_temperature_c",
  "solar_irradiance_wm2",
  "inlet_fluid_temp_c",
  "melting_point_c",
  "latent_heat_kjkg",
  "thermal_conductivity_wmk",
  "pcm_mass_kg",
  "pcm_thickness_mm",
  "mass_flow_rate_kgs",
  "cycle_number",
];

const visualAssets = [
  {
    title: "PCM capsule morphology",
    caption: "Macro and micro encapsulated latent-heat storage with visible phase boundary.",
    src: "/assets/pcm-capsules.png",
    metric: "Material state",
  },
  {
    title: "Building envelope storage",
    caption: "Phase-change panels embedded in a wall assembly for thermal buffering.",
    src: "/assets/pcm-building-envelope.png",
    metric: "Envelope use case",
  },
  {
    title: "Battery and HVAC cooling",
    caption: "PCM modules paired with coolant channels for compact heat removal.",
    src: "/assets/pcm-battery-hvac.png",
    metric: "Cooling use case",
  },
];

export default function App() {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [scenario, setScenario] = useState(null);

  useEffect(() => {
    loadPcmData()
      .then((data) => {
        setRows(data);
        setScenario(defaultScenario(data));
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const summary = useMemo(() => summarize(rows), [rows]);
  const ranges = useMemo(() => (rows.length ? buildRanges(rows) : {}), [rows]);
  const categoryOptions = useMemo(
    () =>
      rows.length
        ? {
            pcm_type: categories(rows, "pcm_type"),
            system_type: categories(rows, "system_type"),
            encapsulation_type: categories(rows, "encapsulation_type"),
          }
        : { pcm_type: [], system_type: [], encapsulation_type: [] },
    [rows],
  );
  const twin = useMemo(() => {
    if (!rows.length || !scenario) return null;
    return predictBySimilarity(rows, scenario, ranges);
  }, [rows, scenario, ranges]);
  const diagnosticItems = useMemo(
    () => (twin && scenario ? diagnostics(twin.prediction, scenario) : []),
    [twin, scenario],
  );
  const recommendations = useMemo(
    () => (rows.length && scenario ? recommend(rows, scenario) : []),
    [rows, scenario],
  );
  const health = useMemo(
    () => (twin && scenario ? healthIndex(twin.prediction, scenario) : null),
    [twin, scenario],
  );

  function updateScenario(key, value) {
    setScenario((current) => ({
      ...current,
      [key]: typeof current?.[key] === "number" ? Number(value) : value,
    }));
  }

  if (loadError) {
    return (
      <main className="load-state">
        <h1>CSV load failed</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!summary || !scenario) {
    return (
      <main className="load-state">
        <div className="loader" />
        <h1>Loading PCM dataset</h1>
        <p>Reading thermal storage records and preparing dashboard metrics.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PCM</span>
          <div>
            <strong>Decision Twin</strong>
            <small>MCP agent platform</small>
          </div>
        </div>

        <nav className="nav-list">
          {tabs.map((tab) => (
            <button
              className={[
                "nav-item",
                activeTab === tab.id ? "active" : "",
                tab.featured ? "featured" : "",
              ].filter(Boolean).join(" ")}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-dot" />
              <span className="nav-label">{tab.label}</span>
              {tab.featured && <span className="nav-badge">CORE</span>}
            </button>
          ))}
        </nav>

        <div className="side-panel">
          <span>Dataset</span>
          <strong>{formatNumber(summary.count)} records</strong>
          <small>{summary.start.slice(0, 10)} to {summary.end.slice(0, 10)}</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>PCM decision twin with MCP agent layer</h1>
            <p>Scenario validation, evidence-audited prediction, What-if analysis, optimization, and reproducible decision packages.</p>
          </div>
          <div className="status-cluster">
            <Status value={`${round(summary.efficiency.mean, 1)}%`} label="Mean efficiency" tone="teal" />
            <Status value={`${round(summary.loss.mean, 1)}%`} label="Mean loss" tone="amber" />
          </div>
        </header>

        {activeTab === "overview" && <Overview rows={rows} summary={summary} />}
        {activeTab === "explorer" && (
          <Explorer rows={rows} options={categoryOptions} ranges={ranges} />
        )}
        {activeTab === "compare" && <Compare rows={rows} />}
        {activeTab === "twin" && (
          <TwinLab
            options={categoryOptions}
            ranges={ranges}
            scenario={scenario}
            updateScenario={updateScenario}
            twin={twin}
            health={health}
            diagnosticItems={diagnosticItems}
          />
        )}
        {activeTab === "forecast" && (
          <Forecast rows={rows} scenario={scenario} options={categoryOptions} updateScenario={updateScenario} />
        )}
        {activeTab === "whatif" && (
          <WhatIf
            rows={rows}
            options={categoryOptions}
            ranges={ranges}
            scenario={scenario}
            updateScenario={updateScenario}
          />
        )}
        {activeTab === "recommend" && (
          <Recommendations
            rows={rows}
            recommendations={recommendations}
            scenario={scenario}
            options={categoryOptions}
            ranges={ranges}
            updateScenario={updateScenario}
          />
        )}
        {activeTab === "report" && (
          <Report
            scenario={scenario}
            twin={twin}
            health={health}
            diagnostics={diagnosticItems}
            recommendations={recommendations}
          />
        )}
        {activeTab === "cloud" && <CloudDeployment />}
        {activeTab === "mcp" && <AgentApiIntegration />}
        {activeTab === "guide" && <OperationGuide />}
        {activeTab === "agent" && (
          <AgentLab
            rows={rows}
            scenario={scenario}
            options={categoryOptions}
            ranges={ranges}
            updateScenario={updateScenario}
          />
        )}
      </main>
    </div>
  );
}

function Overview({ rows, summary }) {
  const pcmGroups = useMemo(() => groupBy(rows, ["pcm_type"]).sort((a, b) => b.efficiency - a.efficiency), [rows]);
  const systemGroups = useMemo(() => groupBy(rows, ["system_type"]).sort((a, b) => b.stored - a.stored), [rows]);
  const tempBands = useMemo(() => {
    const bands = [
      { key: "< -20 C", test: (row) => row.temp_difference_c < -20 },
      { key: "-20 to -10 C", test: (row) => row.temp_difference_c >= -20 && row.temp_difference_c < -10 },
      { key: "-10 to 0 C", test: (row) => row.temp_difference_c >= -10 && row.temp_difference_c < 0 },
      { key: "0 to 10 C", test: (row) => row.temp_difference_c >= 0 && row.temp_difference_c < 10 },
      { key: ">= 10 C", test: (row) => row.temp_difference_c >= 10 },
    ];
    return bands.map((band) => {
      const groupRows = rows.filter(band.test);
      return {
        key: band.key,
        count: groupRows.length,
        efficiency: mean(groupRows, "thermal_storage_efficiency_pct"),
        soc: mean(groupRows, "state_of_charge_pct"),
        phase: mean(groupRows, "phase_fraction"),
      };
    });
  }, [rows]);

  return (
    <section className="page-grid">
      <KpiGrid summary={summary} />

      <VisualContext />

      <Panel title="Efficiency distribution flags" className="wide-panel">
        <div className="flag-grid">
          <MetricFlag
            label="Upper-band records"
            value={`${formatNumber(summary.cap98)} rows`}
            note={`${round((summary.cap98 / summary.count) * 100, 1)}% at exactly 98%`}
            tone="teal"
          />
          <MetricFlag
            label="Lower-band records"
            value={`${formatNumber(summary.floor35)} rows`}
            note={`${round((summary.floor35 / summary.count) * 100, 1)}% at exactly 35%`}
            tone="rose"
          />
          <MetricFlag
            label="Median efficiency"
            value={`${round(summary.efficiency.p50, 1)}%`}
            note="Efficiency is saturated in much of the dataset"
            tone="ink"
          />
        </div>
      </Panel>

      <Panel title="PCM ranking by efficiency">
        <BarList rows={pcmGroups} valueKey="efficiency" suffix="%" color="teal" />
      </Panel>

      <Panel title="System ranking by stored energy">
        <BarList rows={systemGroups} valueKey="stored" suffix=" kJ" color="amber" />
      </Panel>

      <Panel title="Temperature-difference operating bands" className="wide-panel">
        <BandChart rows={tempBands} />
      </Panel>
    </section>
  );
}

function Compare({ rows }) {
  const [grouping, setGrouping] = useState("pcm_type");
  const groups = useMemo(
    () => groupBy(rows, grouping.split("+")).sort((a, b) => b.efficiency - a.efficiency),
    [rows, grouping],
  );

  return (
    <section className="section-stack">
      <div className="toolbar">
        <Segmented
          value={grouping}
          onChange={setGrouping}
          options={[
            ["pcm_type", "PCM"],
            ["system_type", "System"],
            ["encapsulation_type", "Encapsulation"],
            ["pcm_type+system_type", "PCM + system"],
            ["system_type+encapsulation_type", "System + encapsulation"],
          ]}
        />
      </div>

      <Panel title="Performance matrix">
        <DataTable rows={groups.slice(0, 16)} />
      </Panel>

      <div className="two-col">
        <Panel title="Efficiency">
          <BarList rows={groups.slice(0, 10)} valueKey="efficiency" suffix="%" color="teal" />
        </Panel>
        <Panel title="Energy loss">
          <BarList rows={[...groups].sort((a, b) => b.loss - a.loss).slice(0, 10)} valueKey="loss" suffix="%" color="rose" />
        </Panel>
      </div>
    </section>
  );
}

function Explorer({ rows, options, ranges }) {
  const [filters, setFilters] = useState({
    pcm_type: "All",
    system_type: "All",
    encapsulation_type: "All",
    solarMin: ranges.solar_irradiance_wm2?.min ?? 0,
    solarMax: ranges.solar_irradiance_wm2?.max ?? 900,
    cycleMin: ranges.cycle_number?.min ?? 1,
    cycleMax: ranges.cycle_number?.max ?? 2500,
  });

  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const quality = useMemo(() => dataQuality(filtered), [filtered]);
  const groups = useMemo(
    () => groupBy(filtered, ["pcm_type", "system_type"]).sort((a, b) => b.efficiency - a.efficiency),
    [filtered],
  );

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: Number.isFinite(current[key]) ? Number(value) : value,
    }));
  }

  return (
    <section className="section-stack">
      <Panel title="Dataset slice controls">
        <div className="explorer-controls">
          {["pcm_type", "system_type", "encapsulation_type"].map((key) => (
            <label className="field" key={key}>
              <span>{labelMap[key]}</span>
              <select value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
                <option>All</option>
                {options[key].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
          <RangeField
            field="solar_irradiance_wm2"
            range={{ ...ranges.solar_irradiance_wm2, min: filters.solarMin, max: ranges.solar_irradiance_wm2.max }}
            value={filters.solarMax}
            onChange={(value) => updateFilter("solarMax", value)}
          />
          <RangeField
            field="cycle_number"
            range={{ ...ranges.cycle_number, min: filters.cycleMin, max: ranges.cycle_number.max }}
            value={filters.cycleMax}
            onChange={(value) => updateFilter("cycleMax", value)}
          />
        </div>
      </Panel>

      <div className="kpi-grid">
        <MetricFlag label="Filtered rows" value={formatNumber(quality.rows)} note="Current slice size" tone="ink" />
        <MetricFlag label="98% cap share" value={`${round(quality.efficiencyCapPct, 1)}%`} note="Efficiency upper-band records" tone="teal" />
        <MetricFlag label="35% floor share" value={`${round(quality.efficiencyFloorPct, 1)}%`} note="Efficiency lower-band records" tone="rose" />
        <MetricFlag label="High-loss rows" value={formatNumber(quality.highLossCount)} note="Rows above 25% energy loss" tone="amber" />
      </div>

      <Panel title="Filtered PCM-system ranking">
        <DataTable rows={groups.slice(0, 18)} />
      </Panel>

      <div className="two-col">
        <Panel title="Filtered efficiency">
          <BarList rows={groups.slice(0, 10)} valueKey="efficiency" suffix="%" color="teal" />
        </Panel>
        <Panel title="Filtered stored energy">
          <BarList rows={[...groups].sort((a, b) => b.stored - a.stored).slice(0, 10)} valueKey="stored" suffix=" kJ" color="amber" />
        </Panel>
      </div>
    </section>
  );
}

function TwinLab({ options, ranges, scenario, updateScenario, twin, health, diagnosticItems }) {
  const prediction = twin.prediction;
  const advice = useMemo(
    () => diagnosticRecommendations(prediction, scenario, health),
    [prediction, scenario, health],
  );

  return (
    <section className="twin-layout">
      <Panel title="Scenario controls" className="control-panel">
        <div className="select-grid">
          {["pcm_type", "system_type", "encapsulation_type"].map((key) => (
            <label className="field" key={key}>
              <span>{labelMap[key]}</span>
              <select value={scenario[key]} onChange={(event) => updateScenario(key, event.target.value)}>
                {options[key].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="slider-grid">
          {sliderConfig.map((key) => (
            <RangeField
              key={key}
              field={key}
              range={ranges[key]}
              value={scenario[key]}
              onChange={(value) => updateScenario(key, value)}
            />
          ))}
        </div>
      </Panel>

      <div className="result-column">
        <Panel title="Predicted twin state">
          <div className="prediction-grid">
            <Gauge label="Phase fraction" value={prediction.phase_fraction * 100} suffix="%" tone="teal" />
            <Gauge label="SOC" value={prediction.state_of_charge_pct} suffix="%" tone="amber" />
            <MetricFlag label="Stored energy" value={`${round(prediction.stored_energy_kj, 0)} kJ`} note={`${twin.sampleSize} nearest records`} tone="ink" />
            <MetricFlag label="Efficiency" value={`${round(prediction.thermal_storage_efficiency_pct, 1)}%`} note={`${round(twin.dataSupportScore, 0)}/100 data-support score`} tone="teal" />
            <MetricFlag label="Energy loss" value={`${round(prediction.energy_loss_pct, 1)}%`} note={`${formatNumber(twin.exactCategoryRows)} matching category rows`} tone="rose" />
          </div>
        </Panel>

        <Panel title="Local empirical ranges">
          <UncertaintyPanel intervals={twin.intervals} prediction={prediction} />
        </Panel>

        <Panel title="Diagnostics">
          <div className="diagnostic-list">
            {diagnosticItems.map((item) => (
              <div className={`diagnostic ${item.level.toLowerCase()}`} key={`${item.level}-${item.title}`}>
                <span>{item.level}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="PCM Health Index">
          <HealthCard health={health} />
        </Panel>

        <Panel title="Control advisor">
          <AdviceList advice={advice} />
        </Panel>

        <Panel title="Nearest evidence records">
          <EvidenceTable rows={twin.neighbors.slice(0, 6)} />
        </Panel>
      </div>
    </section>
  );
}

function Forecast({ rows, scenario, options, updateScenario }) {
  const profile = useMemo(() => hourlyProfile(rows, scenario), [rows, scenario]);
  const windows = useMemo(() => bestOperatingWindows(profile), [profile]);

  return (
    <section className="section-stack">
      <Panel title="Operating-profile context">
        <div className="recommend-context">
          {["pcm_type", "system_type", "encapsulation_type"].map((key) => (
            <label className="field" key={key}>
              <span>{labelMap[key]}</span>
              <select value={scenario[key]} onChange={(event) => updateScenario(key, event.target.value)}>
                {options[key].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="24-hour operating profile">
        <HourlyProfileChart profile={profile} />
      </Panel>

      <Panel title="Best charge/discharge windows">
        <div className="window-grid">
          {windows.map((window) => (
            <article className="window-card" key={window.hour}>
              <span>{String(window.hour).padStart(2, "0")}:00</span>
              <strong>{round(window.score * 100, 1)}</strong>
              <small>
                Eff {round(window.efficiency, 1)}% · SOC {round(window.soc, 1)}% ·
                stored {round(window.stored, 0)} kJ
              </small>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function WhatIf({ rows, options, ranges, scenario, updateScenario }) {
  const [candidate, setCandidate] = useState(() => ({
    ...scenario,
    encapsulation_type: "Macro",
    mass_flow_rate_kgs: round(scenario.mass_flow_rate_kgs * 1.25, 3),
    melting_point_c: round(scenario.melting_point_c - 2, 2),
  }));

  const baseTwin = useMemo(
    () => predictBySimilarity(rows, scenario, ranges),
    [rows, scenario, ranges],
  );
  const candidateTwin = useMemo(
    () => predictBySimilarity(rows, candidate, ranges),
    [rows, candidate, ranges],
  );
  const delta = useMemo(
    () => comparePredictions(baseTwin.prediction, candidateTwin.prediction),
    [baseTwin, candidateTwin],
  );

  function updateCandidate(key, value) {
    setCandidate((current) => ({
      ...current,
      [key]: typeof current?.[key] === "number" ? Number(value) : value,
    }));
  }

  function syncCandidate() {
    setCandidate({ ...scenario });
  }

  return (
    <section className="section-stack">
      <Panel title="Scenario A: current baseline">
        <div className="compact-scenario">
          <div>
            <strong>{scenario.pcm_type}</strong>
            <span>{scenario.system_type} · {scenario.encapsulation_type}</span>
          </div>
          <button className="secondary-button" onClick={syncCandidate}>Copy A to B</button>
        </div>
        <ScenarioMiniControls
          options={options}
          ranges={ranges}
          scenario={scenario}
          updateScenario={updateScenario}
        />
      </Panel>

      <Panel title="Scenario B: candidate design">
        <ScenarioMiniControls
          options={options}
          ranges={ranges}
          scenario={candidate}
          updateScenario={updateCandidate}
        />
      </Panel>

      <Panel title="What-if impact">
        <div className="whatif-grid">
          <DeltaCard label="Efficiency" value={delta.efficiency} suffix="%" positiveIsGood />
          <DeltaCard label="Stored energy" value={delta.stored} suffix=" kJ" positiveIsGood />
          <DeltaCard label="SOC" value={delta.soc} suffix="%" positiveIsGood />
          <DeltaCard label="Energy loss" value={delta.loss} suffix="%" />
          <DeltaCard label="Phase fraction" value={delta.phase * 100} suffix="%" positiveIsGood />
        </div>
        <div className="compare-strip">
          <PredictionSummary title="Baseline A" prediction={baseTwin.prediction} />
          <PredictionSummary title="Candidate B" prediction={candidateTwin.prediction} />
        </div>
      </Panel>
    </section>
  );
}

function Recommendations({ rows, recommendations, scenario, options, ranges, updateScenario }) {
  const matrix = useMemo(
    () => adaptationMatrix(rows, scenario.system_type),
    [rows, scenario.system_type],
  );

  return (
    <section className="section-stack">
      <Panel title="Recommendation context">
        <div className="recommend-context">
          <label className="field">
            <span>Target system</span>
            <select value={scenario.system_type} onChange={(event) => updateScenario("system_type", event.target.value)}>
              {options.system_type.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          {["air_temperature_c", "solar_irradiance_wm2", "inlet_fluid_temp_c"].map((key) => (
            <RangeField
              key={key}
              field={key}
              range={ranges[key]}
              value={scenario[key]}
              onChange={(value) => updateScenario(key, value)}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Application image context">
        <ApplicationImageStrip activeSystem={scenario.system_type} />
      </Panel>

      <Panel title="Top data-backed combinations">
        <div className="recommend-grid">
          {recommendations.map((item, index) => (
            <article className="recommend-card" key={item.key}>
              <div className="rank">{index + 1}</div>
              <h3>{item.key}</h3>
              <div className="score-line">
                <span style={{ width: `${round(item.score * 100, 0)}%` }} />
              </div>
              <dl>
                <div><dt>Score</dt><dd>{round(item.score * 100, 1)}</dd></div>
                <div><dt>Efficiency</dt><dd>{round(item.efficiency, 1)}%</dd></div>
                <div><dt>Stored</dt><dd>{round(item.stored, 0)} kJ</dd></div>
                <div><dt>Loss</dt><dd>{round(item.loss, 1)}%</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Material-encapsulation fit heatmap">
        <FitHeatmap matrix={matrix} />
      </Panel>
    </section>
  );
}

function VisualContext() {
  return (
    <section className="visual-context wide-panel">
      <article className="visual-feature">
        <img src={visualAssets[0].src} alt={visualAssets[0].title} />
        <div className="visual-copy">
          <span>{visualAssets[0].metric}</span>
          <h2>{visualAssets[0].title}</h2>
          <p>{visualAssets[0].caption}</p>
        </div>
      </article>
      <div className="visual-side">
        {visualAssets.slice(1).map((asset) => (
          <article className="visual-card" key={asset.title}>
            <img src={asset.src} alt={asset.title} />
            <div>
              <span>{asset.metric}</span>
              <strong>{asset.title}</strong>
              <p>{asset.caption}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ApplicationImageStrip({ activeSystem }) {
  const selected =
    activeSystem === "BatteryCooling" || activeSystem === "HVACStorage"
      ? visualAssets[2]
      : activeSystem === "BuildingEnvelope"
        ? visualAssets[1]
        : visualAssets[0];

  return (
    <div className="application-strip">
      <div className="application-image">
        <img src={selected.src} alt={selected.title} />
      </div>
      <div className="application-copy">
        <span>Selected system visual</span>
        <h3>{selected.title}</h3>
        <p>{selected.caption}</p>
        <small>Linked to current target system: {activeSystem}</small>
      </div>
    </div>
  );
}

function Report({ scenario, twin, health, diagnostics, recommendations }) {
  const report = useMemo(
    () => buildReport({ scenario, twin, health, diagnostics, recommendations }),
    [scenario, twin, health, diagnostics, recommendations],
  );

  function exportJson() {
    downloadFile(
      "pcm-digital-twin-report.json",
      JSON.stringify(report, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const lines = [
      "metric,value",
      `pcm_type,${report.scenario.pcm_type}`,
      `system_type,${report.scenario.system_type}`,
      `encapsulation_type,${report.scenario.encapsulation_type}`,
      `efficiency_pct,${report.prediction.thermal_storage_efficiency_pct}`,
      `stored_energy_kj,${report.prediction.stored_energy_kj}`,
      `soc_pct,${report.prediction.state_of_charge_pct}`,
      `phase_fraction,${report.prediction.phase_fraction}`,
      `energy_loss_pct,${report.prediction.energy_loss_pct}`,
      `health_index,${report.health.index}`,
      `health_status,${report.health.status}`,
      `data_support_score,${report.data_support_score}`,
    ];
    downloadFile("pcm-decision-twin-report.csv", lines.join("\n"), "text/csv");
  }

  return (
    <section className="report-layout">
      <Panel title="Executive snapshot">
        <div className="report-actions">
          <button className="primary-button" onClick={exportJson}>Export JSON</button>
          <button className="secondary-button" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="report-grid">
          <MetricFlag label="Health" value={`${round(report.health.index, 1)}/100`} note={report.health.status} tone="teal" />
          <MetricFlag label="Efficiency" value={`${report.prediction.thermal_storage_efficiency_pct}%`} note={`${report.data_support_score}/100 data-support score`} tone="ink" />
          <MetricFlag label="Stored energy" value={`${round(report.prediction.stored_energy_kj, 0)} kJ`} note="Estimated from nearby records" tone="amber" />
        </div>
      </Panel>

      <Panel title="Scenario and diagnostics">
        <div className="report-summary">
          <p>
            The selected scenario uses <strong>{scenario.pcm_type}</strong> in a
            {" "}<strong>{scenario.system_type}</strong> system with
            {" "}<strong>{scenario.encapsulation_type}</strong> encapsulation.
            The dominant health driver is <strong>{report.health.top_driver}</strong>.
          </p>
          <div className="diagnostic-list">
            {diagnostics.map((item) => (
              <div className={`diagnostic ${item.level.toLowerCase()}`} key={`${item.level}-${item.title}`}>
                <span>{item.level}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Top recommendations">
        <DataTable rows={recommendations.slice(0, 5)} />
      </Panel>
    </section>
  );
}

function CloudDeployment() {
  const [healthState, setHealthState] = useState({ status: "idle", message: "Not checked" });

  async function runHealthCheck() {
    setHealthState({ status: "checking", message: "Checking API health..." });
    try {
      const result = await checkApiHealth();
      setHealthState({ status: "ok", message: `${result.service}: ${result.status}` });
    } catch (error) {
      setHealthState({ status: "error", message: error.message });
    }
  }

  const items = [
    ["Frontend", "Vercel or Netlify", "Configured with Vite build output in dist"],
    ["Backend API", "FastAPI container", "Auth, dataset upload, metadata, summary, prediction endpoints"],
    ["Database", "PostgreSQL / Supabase", "Dataset metadata table and owner policies"],
    ["Object storage", "S3 / Supabase Storage", "CSV uploads and future model artifacts"],
    ["Model service", "Separate FastAPI service", "Boundary for trained models, PINNs, or MLflow"],
    ["Auth", "Prototype JWT", "Replace with Supabase Auth, Auth0, Clerk, or SSO for production"],
  ];

  return (
    <section className="section-stack">
      <Panel title="Cloud deployment control plane">
        <div className="cloud-hero">
          <div>
            <span>API endpoint</span>
            <h2>{API_BASE_URL}</h2>
            <p>This page checks whether the deployed backend is reachable from the frontend.</p>
          </div>
          <div className={`cloud-health ${healthState.status}`}>
            <strong>{healthState.message}</strong>
            <button className="primary-button" onClick={runHealthCheck}>
              Check API
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Cloud architecture image">
        <div className="module-visual">
          <img src="/assets/cloud-architecture.svg" alt="Cloud deployment blueprint for the PCM decision twin" />
        </div>
      </Panel>

      <Panel title="Cloud platform modules">
        <div className="cloud-grid">
          {items.map(([title, target, detail]) => (
            <article className="cloud-card" key={title}>
              <span>{title}</span>
              <strong>{target}</strong>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Deployment files now in this project">
        <div className="deployment-list">
          <code>vercel.json</code>
          <code>netlify.toml</code>
          <code>docker-compose.yml</code>
          <code>backend/Dockerfile</code>
          <code>model_service/Dockerfile</code>
          <code>deploy/supabase/schema.sql</code>
          <code>docs/cloud-deployment.md</code>
          <code>.env.example</code>
        </div>
      </Panel>
    </section>
  );
}

function AgentApiIntegration() {
  const tools = [
    ["get_summary", "Dataset summary and saturation flags"],
    ["describe_inputs", "Model input names, ranges, and default scenario"],
    ["validate_scenario", "Support range, evidence level, support score, fallback"],
    ["explain_prediction", "Nearest evidence, weights, saturation, key drivers"],
    ["predict_twin_state", "SOC, phase, energy, loss, efficiency, health, diagnostics, advice"],
    ["run_sensitivity_analysis", "Variable sweep and risk-zone detection"],
    ["optimize_pcm_design", "Objective-ranked PCM design alternatives"],
    ["generate_decision_package", "End-to-end auditable workflow output"],
    ["get_mcp_benchmark", "Workflow success metrics for MCP evaluation"],
    ["run_what_if", "Baseline vs candidate scenario comparison"],
    ["recommend_design", "PCM and encapsulation ranking for a target context"],
    ["get_operating_windows", "24-hour profile and best charge/discharge windows"],
    ["generate_report", "Structured JSON diagnostic report"],
  ];

  const prompts = [
    "Find the best BuildingEnvelope PCM design near 25 C air temperature.",
    "Run a What-if comparison: Macro encapsulation vs ShapeStabilized.",
    "Generate a diagnostic report for Organic_Paraffin in BatteryCooling.",
  ];

  return (
    <section className="section-stack">
      <Panel title="Agent API integration">
        <div className="mcp-hero">
          <div>
            <span>Developer integration layer</span>
            <h2>Connect external MCP clients to the PCM decision twin</h2>
            <p>
              Agent Lab is the user-facing workspace. This page is the developer-facing
              API reference for connecting external MCP clients to the same validation,
              evidence audit, sensitivity, optimization, and reporting workflow.
            </p>
          </div>
          <div className="mcp-command">
            <code>npm run mcp</code>
            <small>Agent API over stdio MCP</small>
          </div>
        </div>
      </Panel>

      <Panel title="Agent API workflow image">
        <div className="module-visual">
          <img src="/assets/agent-workflow.svg" alt="Agent API workflow for external MCP clients" />
        </div>
      </Panel>

      <Panel title="Agent API tools">
        <div className="mcp-tool-grid">
          {tools.map(([name, detail]) => (
            <article className="mcp-tool-card" key={name}>
              <code>{name}</code>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="MCP client configuration">
        <pre className="code-block">{`{
  "mcpServers": {
    "pcm-decision-twin-agent": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/pcm_decision_twin_platform",
      "env": {
        "PCM_DATASET_PATH": "/absolute/path/to/pcm_decision_twin_platform/pcm_thermal_storage.csv"
      }
    }
  }
}`}</pre>
      </Panel>

      <Panel title="Example external-agent prompts">
        <div className="prompt-list">
          {prompts.map((prompt) => (
            <article className="prompt-card" key={prompt}>{prompt}</article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function OperationGuide() {
  const modules = [
    {
      name: "Overview",
      purpose: "Understand the dataset at a glance.",
      steps: [
        "Check record count, time span, mean efficiency, mean loss, stored energy, and SOC.",
        "Use the image context and distribution flags to understand the data scope.",
        "Look at PCM and system rankings before making a detailed scenario.",
      ],
      output: "A quick sense of dataset quality, dominant PCM groups, and saturation flags.",
    },
    {
      name: "Explorer",
      purpose: "Filter the dataset and inspect data quality for a slice.",
      steps: [
        "Choose PCM type, system type, or encapsulation from the selectors.",
        "Adjust solar irradiance and cycle-number ranges.",
        "Read filtered rows, 98% cap share, 35% floor share, and high-loss rows.",
      ],
      output: "A filtered data slice with quality diagnostics and ranked groups.",
    },
    {
      name: "Compare",
      purpose: "Compare PCM, system, and encapsulation groups.",
      steps: [
        "Select grouping mode such as PCM, system, or PCM + system.",
        "Review the performance matrix.",
        "Compare efficiency and energy-loss bar charts.",
      ],
      output: "A ranked comparison of material and system configurations.",
    },
    {
      name: "Twin Lab",
      purpose: "Run a single scenario prediction with nearest-record evidence.",
      steps: [
        "Set PCM type, system type, and encapsulation.",
        "Adjust operating inputs with sliders.",
        "Read predicted phase fraction, SOC, stored energy, efficiency, loss, health, uncertainty, diagnostics, and nearest evidence records.",
      ],
      output: "A data-backed PCM state estimate for one scenario.",
    },
    {
      name: "Operating profile",
      purpose: "Inspect a scenario-level 24-hour operating profile.",
      steps: [
        "Choose the scenario categories.",
        "Read the hourly profile chart for efficiency, SOC, and stored energy.",
        "Use best charge/discharge windows for operational planning.",
      ],
      output: "Candidate daily operating windows, not a real-time field forecast.",
    },
    {
      name: "What-if",
      purpose: "Compare a baseline scenario against a candidate scenario.",
      steps: [
        "Use Scenario A as the baseline.",
        "Modify Scenario B or copy A to B and then adjust one design variable.",
        "Read deltas for efficiency, stored energy, SOC, loss, and phase fraction.",
      ],
      output: "A direct A/B comparison of design or operating choices.",
    },
    {
      name: "Recommend",
      purpose: "Rank PCM and encapsulation options for a target context.",
      steps: [
        "Choose target system and key operating conditions.",
        "Review top data-backed combinations.",
        "Use the fit heatmap to compare PCM and encapsulation pairs.",
      ],
      output: "A ranked candidate list for engineering selection.",
    },
    {
      name: "Report",
      purpose: "Export a compact scenario report.",
      steps: [
        "Review executive snapshot, diagnostics, and top recommendations.",
        "Export JSON for machine-readable use.",
        "Export CSV for spreadsheet workflows.",
      ],
      output: "A portable diagnostic report for the current scenario.",
    },
    {
      name: "Cloud",
      purpose: "Review cloud deployment architecture.",
      steps: [
        "Check API health if a backend service is running.",
        "Review frontend, backend, database, object storage, model service, and auth modules.",
        "Use deployment file list as an implementation checklist.",
      ],
      output: "A cloud deployment blueprint.",
    },
    {
      name: "Agent API",
      purpose: "Connect external tool clients through MCP.",
      steps: [
        "Review available Agent API tools.",
        "Copy the MCP client configuration.",
        "Use example prompts to test external agent integration.",
      ],
      output: "A developer-facing MCP integration reference.",
    },
    {
      name: "Agent Lab",
      purpose: "Run the full MCP-style decision workflow.",
      steps: [
        "Choose or edit the active scenario.",
        "Enter an Agent task or choose a scenario template.",
        "Click Parse task to detect objective, sensitivity variable, fallback, and step count.",
        "Adjust constraints if needed.",
        "Click Run workflow and watch progress, step logs, evidence audit, risk map, optimization, counterfactuals, and report outputs.",
      ],
      output: "A complete auditable PCM decision package with evidence, risks, recommendations, and exports.",
    },
  ];

  const simpleExample = [
    ["1", "Open Agent Lab", "Click the highlighted Agent Lab item in the left sidebar."],
    ["2", "Use a simple task", "Type: Scan solar irradiance with 5 steps and maximize stored energy."],
    ["3", "Parse task", "Click Parse task and confirm Objective = stored_energy and Sensitivity = Solar irradiance."],
    ["4", "Run workflow", "Click Run workflow and watch the progress bar until Workflow completed."],
    ["5", "Read result", "Check scenario support, decision risk map, optimization candidates, and nearest evidence records."],
    ["6", "Export", "Click Export package or Export Markdown."],
  ];

  return (
    <section className="section-stack">
      <Panel title="Platform operation guide">
        <div className="guide-hero">
          <div>
            <span>How to use this platform</span>
            <h2>PCM Decision Twin User Guide</h2>
            <p>
              This guide explains what each module does, how to operate it, and what output
              to expect. For first-time use, start with the simple Agent Lab example below.
            </p>
          </div>
          <div className="guide-summary">
            <strong>Suggested path</strong>
            <span>Overview {"->"} Twin Lab {"->"} What-if {"->"} Recommend {"->"} Agent Lab {"->"} Report</span>
          </div>
        </div>
        <div className="module-visual guide-visual">
          <img src="/assets/guide-workflow.svg" alt="Recommended operation path for the PCM decision twin platform" />
        </div>
      </Panel>

      <Panel title="Simplest example: one Agent Lab run">
        <div className="guide-example-grid">
          {simpleExample.map(([step, title, detail]) => (
            <article className="guide-step-card" key={step}>
              <span>{step}</span>
              <strong>{title}</strong>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Module-by-module instructions">
        <div className="guide-module-list">
          {modules.map((module) => (
            <article className="guide-module-card" key={module.name}>
              <header>
                <strong>{module.name}</strong>
                <span>{module.purpose}</span>
              </header>
              <ol>
                {module.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <footer>{module.output}</footer>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Common user questions">
        <div className="guide-faq-grid">
          <article>
            <strong>Where should I start?</strong>
            <p>Use Overview for dataset context, then Agent Lab for the most complete workflow.</p>
          </article>
          <article>
            <strong>What does scenario support mean?</strong>
            <p>It is a heuristic 0--100 score combining data ranges, exact-category records, evidence level, warnings, and extension penalties. It is not a probability.</p>
          </article>
          <article>
            <strong>Why can Run workflow take time?</strong>
            <p>It performs nearest-record prediction, sensitivity analysis, optimization, risk mapping, counterfactual search, and report generation.</p>
          </article>
          <article>
            <strong>When should I use Agent API?</strong>
            <p>Use Agent API when connecting an external MCP-capable AI client to this platform.</p>
          </article>
        </div>
      </Panel>
    </section>
  );
}

function AgentLab({ rows, scenario, options, ranges, updateScenario }) {
  const initialStepStatus = Object.fromEntries(agentRunSteps.map(([name]) => [name, "queued"]));
  const [task, setTask] = useState(
    "Validate the current PCM scenario, explain the prediction evidence, scan air temperature sensitivity, optimize the design, and generate a decision package.",
  );
  const [objective, setObjective] = useState("balance");
  const [sensitivityVariable, setSensitivityVariable] = useState("air_temperature_c");
  const [parsedIntent, setParsedIntent] = useState(() => parseAgentTask(""));
  const [packageResult, setPackageResult] = useState(null);
  const [runHistory, setRunHistory] = useState(() => loadAgentHistory());
  const [constraints, setConstraints] = useState({
    min_data_support: 60,
    max_energy_loss_pct: 26,
    min_soc_pct: 15,
    only_direct_evidence: false,
    allow_extensions: true,
  });
  const [compareRuns, setCompareRuns] = useState({ a: "", b: "" });
  const [workflowStatus, setWorkflowStatus] = useState("queued");
  const [executionMode, setExecutionMode] = useState("gateway-pending");
  const [executionNote, setExecutionNote] = useState(`Gateway: ${MCP_GATEWAY_URL}`);
  const [stepStatus, setStepStatus] = useState(initialStepStatus);
  const [workflowProgress, setWorkflowProgress] = useState({
    current: "Ready",
    percent: 0,
    elapsed: 0,
    startedAt: null,
    log: [],
  });
  const [benchmark, setBenchmark] = useState({
    tool_discovery_success: "pending",
    resource_retrieval_success: "pending",
    malformed_input_rejection: "pending",
    report_generation_success: "pending",
  });
  const validation = useMemo(() => validateScenario(rows, scenario), [rows, scenario]);
  const explanation = packageResult?.prediction_explanation;
  const sensitivity = packageResult?.sensitivity_analysis;
  const optimization = packageResult?.optimization;
  const fallbackComparison = packageResult?.fallback_comparison;
  const riskMap = packageResult?.risk_map ?? [];
  const multiSensitivity = packageResult?.multi_variable_sensitivity;
  const modelComparison = packageResult?.model_comparison ?? [];
  const quality = packageResult?.scenario_quality;
  const constrainedOptimization = packageResult?.constrained_optimization;
  const decisionTrace = packageResult?.decision_trace ?? [];
  const evidenceCluster = packageResult?.evidence_cluster ?? [];
  const counterfactuals = packageResult?.counterfactual_recommendations ?? [];
  const uncertaintyDrivers = packageResult?.uncertainty_drivers ?? [];
  const runComparison = useMemo(
    () => compareHistoryRuns(runHistory, compareRuns.a, compareRuns.b),
    [runHistory, compareRuns],
  );
  const toolCallPreview = useMemo(
    () => buildToolCallPreview(scenario, parsedIntent),
    [scenario, parsedIntent],
  );

  useEffect(() => {
    if (workflowStatus !== "running" || !workflowProgress.startedAt) return undefined;
    const timer = window.setInterval(() => {
      setWorkflowProgress((current) => ({
        ...current,
        elapsed: Math.max(0, Math.round((Date.now() - current.startedAt) / 1000)),
      }));
    }, 500);
    return () => window.clearInterval(timer);
  }, [workflowStatus, workflowProgress.startedAt]);

  function applyTaskIntent() {
    const intent = parseAgentTask(task);
    setParsedIntent(intent);
    setObjective(intent.objective);
    setSensitivityVariable(intent.sensitivity_variable);
    return intent;
  }

  async function runWorkflow() {
    const intent = applyTaskIntent();
    setPackageResult(null);
    setWorkflowStatus("running");
    setExecutionMode("mcp-gateway");
    setExecutionNote(`Connecting to ${MCP_GATEWAY_URL}`);
    setStepStatus(initialStepStatus);
    setWorkflowProgress({
      current: "Connecting to MCP Gateway",
      percent: 1,
      elapsed: 0,
      startedAt: Date.now(),
      log: ["MCP Gateway requested"],
    });

    try {
      const capabilities = await checkMcpGateway();
      setBenchmark({
        tool_discovery_success: `${capabilities.tools.length}/${capabilities.tools.length}`,
        resource_retrieval_success: `${capabilities.resources.length}/${capabilities.resources.length}`,
        malformed_input_rejection: "validated by benchmark",
        report_generation_success: "running",
      });
      const completedRun = await runAgentWorkflowViaGateway({
        task,
        scenario,
        objective: intent.objective,
        sensitivity_variable: intent.sensitivity_variable,
        sensitivity_steps: intent.sensitivity_steps,
        evidence_limit: 6,
        use_fallback: intent.use_fallback,
        allow_system_change: intent.allow_system_change,
        constraints,
      }, {
        onUpdate: (run) => {
          const completed = new Set(run.completed_steps || []);
          setStepStatus(Object.fromEntries(agentRunSteps.map(([name]) => [
            name,
            completed.has(name) ? "success" : run.current_step === name ? "running" : "queued",
          ])));
          setWorkflowProgress((current) => ({
            ...current,
            current: run.current_step === "completed" ? "Workflow completed" : `MCP: ${run.current_step}`,
            percent: run.progress_pct,
            log: [
              ...(run.tool_trace || []).slice(-5).reverse().map((item) => `${item.tool}: ${item.status}`),
              ...current.log,
            ].slice(0, 8),
          }));
        },
      });
      const result = completedRun.result;
      setPackageResult(result);
      saveHistoryEntry(result, task, setRunHistory);
      setBenchmark((current) => ({
        ...current,
        malformed_input_rejection: "success",
        report_generation_success: "success",
      }));
      setExecutionMode("mcp-gateway");
      setExecutionNote(`Real MCP trace · ${completedRun.tool_trace.length} calls · ${completedRun.report_hash.slice(0, 12)}`);
      setWorkflowStatus("completed");
      setWorkflowProgress((current) => ({
        ...current,
        current: "Workflow completed",
        percent: 100,
        log: ["Real MCP workflow completed", ...current.log].slice(0, 8),
      }));
    } catch (error) {
      setExecutionMode("local-fallback");
      setExecutionNote(`Gateway unavailable: ${error.message}`);
      await runLocalWorkflow(intent, error.message);
    }
  }

  async function runLocalWorkflow(intent, gatewayError = "") {
    const selectedObjective = intent.objective;
    const selectedVariable = intent.sensitivity_variable;
    setPackageResult(null);
    setWorkflowStatus("running");
    setStepStatus(initialStepStatus);
    setWorkflowProgress({
      current: "Starting agent workflow",
      percent: 3,
      elapsed: 0,
      startedAt: Date.now(),
      log: [gatewayError ? "Local fallback activated" : "Workflow queued"],
    });

    const runStep = async (name, work, index) => {
      const detail = agentRunSteps.find(([stepName]) => stepName === name)?.[1] ?? name;
      setStepStatus((current) => ({ ...current, [name]: "running" }));
      setWorkflowProgress((current) => ({
        ...current,
        current: detail,
        percent: Math.max(current.percent, Math.round((index / agentRunSteps.length) * 100)),
        log: [`${name}: running`, ...current.log].slice(0, 8),
      }));
      await sleep(40);
      const result = work();
      setStepStatus((current) => ({ ...current, [name]: "success" }));
      setWorkflowProgress((current) => ({
        ...current,
        current: `${detail} completed`,
        percent: Math.max(current.percent, Math.round(((index + 1) / agentRunSteps.length) * 100)),
        log: [`${name}: success`, ...current.log].slice(0, 8),
      }));
      await sleep(30);
      return result;
    };

    try {
      const validationResult = await runStep("validate_scenario", () => validateScenario(rows, scenario), 0);
      const fallbackResult = await runStep("explain_prediction", () => ({
        explanation: explainPrediction(rows, scenario, { evidence_limit: 6, use_fallback: intent.use_fallback }),
        fallback: compareFallbackPrediction(rows, scenario),
      }), 1);
      const sensitivityResult = await runStep("run_sensitivity_analysis", () =>
        runSensitivityAnalysis(rows, scenario, {
          variable: selectedVariable,
          steps: intent.sensitivity_steps,
          objective: selectedObjective,
        }),
        2,
      );
      const optimizationResult = await runStep("optimize_pcm_design", () =>
        optimizePcmDesign(rows, scenario, {
          objective: selectedObjective,
          allow_system_change: intent.allow_system_change,
          limit: 6,
        }),
        3,
      );
      const nextPackage = await runStep("generate_decision_package", () => generateAgentDecisionPackage(rows, scenario, {
        objective: selectedObjective,
        sensitivity_variable: selectedVariable,
        sensitivity_steps: intent.sensitivity_steps,
        evidence_limit: 6,
        use_fallback: intent.use_fallback,
        task_intent: intent,
        task_text: task,
        constraints,
        full_analysis: false,
      }), 4);
      const partialPackage = {
        ...nextPackage,
        scenario_validation: validationResult,
        fallback_comparison: fallbackResult.fallback,
        prediction_explanation: fallbackResult.explanation,
        sensitivity_analysis: sensitivityResult,
        optimization: optimizationResult,
      };
      setPackageResult(partialPackage);

      const multiSensitivityResult = await runStep("multi_variable_sensitivity", () =>
        runMultiVariableSensitivity(rows, scenario, {
          objective: selectedObjective,
          steps: 5,
        }),
        5,
      );
      const constrainedResult = await runStep("constraint_filter", () =>
        runConstraintAwareOptimization(rows, scenario, {
          objective: selectedObjective,
          ...constraints,
        }),
        6,
      );
      const counterfactualResult = await runStep("counterfactual_recommendation", () =>
        buildCounterfactualRecommendations(rows, scenario),
        7,
      );
      const fullPackage = {
        ...partialPackage,
        multi_variable_sensitivity: multiSensitivityResult,
        constrained_optimization: constrainedResult,
        counterfactual_recommendations: counterfactualResult,
        model_comparison: compareTwinModels(rows, scenario),
        scenario_quality: decomposeScenarioQuality(validationResult),
        decision_trace: buildDecisionTrace(intent, validationResult, fallbackResult.explanation, optimizationResult, fallbackResult.fallback),
        evidence_cluster: buildEvidenceCluster(fallbackResult.explanation),
        uncertainty_drivers: explainUncertainty(validationResult, fallbackResult.explanation),
      };
      setPackageResult(fullPackage);

      await runStep("benchmark_update", () => {
        saveHistoryEntry(fullPackage, task, setRunHistory);
        setBenchmark(mcpBenchmark(rows));
        return true;
      }, 8);
      setWorkflowStatus("completed");
      setExecutionMode("local-fallback");
      setWorkflowProgress((current) => ({
        ...current,
        current: "Workflow completed",
        percent: 100,
        log: ["Workflow completed", ...current.log].slice(0, 8),
      }));
    } catch (error) {
      setWorkflowStatus("failed");
      setStepStatus((current) =>
        Object.fromEntries(Object.entries(current).map(([name, status]) => [name, status === "running" ? "failed" : status])),
      );
      setWorkflowProgress((current) => ({
        ...current,
        current: "Workflow failed",
        log: [`Error: ${error.message}`, ...current.log].slice(0, 8),
      }));
      console.error(error);
    }
  }

  function exportPackage() {
    const intent = parseAgentTask(task);
    const result =
      packageResult ??
      generateAgentDecisionPackage(rows, scenario, {
        objective: intent.objective,
        sensitivity_variable: intent.sensitivity_variable,
        sensitivity_steps: intent.sensitivity_steps,
        evidence_limit: 6,
        use_fallback: intent.use_fallback,
        task_intent: intent,
        task_text: task,
        constraints,
        full_analysis: true,
      });
    downloadFile(
      "pcm-mcp-decision-package.json",
      JSON.stringify(result, null, 2),
      "application/json",
    );
  }

  function exportMarkdown() {
    const intent = parseAgentTask(task);
    const result =
      packageResult ??
      generateAgentDecisionPackage(rows, scenario, {
        objective: intent.objective,
        sensitivity_variable: intent.sensitivity_variable,
        sensitivity_steps: intent.sensitivity_steps,
        evidence_limit: 6,
        use_fallback: intent.use_fallback,
        task_intent: intent,
        task_text: task,
        constraints,
        full_analysis: true,
      });
    downloadFile("pcm-agent-report.md", buildMarkdownReport(result), "text/markdown");
  }

  function exportHistoryPackage(entry) {
    downloadFile(
      `pcm-agent-history-${entry.id}.json`,
      JSON.stringify(entry.package, null, 2),
      "application/json",
    );
  }

  function applyScenarioPreset(preset) {
    setTask(preset.task);
    setParsedIntent(parseAgentTask(preset.task));
    Object.entries(preset.scenario).forEach(([key, value]) => updateScenario(key, value));
    setPackageResult(null);
    setWorkflowStatus("queued");
    setStepStatus(initialStepStatus);
  }

  function updateConstraint(key, value) {
    setConstraints((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="agent-layout">
      <Panel title="MCP decision-workflow workspace" className="agent-hero-panel">
        <div className="agent-hero">
          <div>
            <span>Auditable tool workflow</span>
            <h2>PCM Decision-Twin Workflow Lab</h2>
            <p>
              The lab executes the decision workflow exposed by MCP: scenario validation,
              evidence-audited prediction, sensitivity analysis, design optimization, and a
              reproducible decision package.
            </p>
          </div>
          <div className="agent-actions">
            <button className="primary-button" onClick={runWorkflow} disabled={workflowStatus === "running"}>
              {workflowStatus === "running" ? "Running..." : "Run workflow"}
            </button>
            <button className="secondary-button" onClick={applyTaskIntent}>
              Parse task
            </button>
            <button className="secondary-button" onClick={exportPackage}>
              Export package
            </button>
            <button className="secondary-button" onClick={exportMarkdown}>
              Export Markdown
            </button>
          </div>
        </div>
        <label className="agent-task">
          <span>Analysis task</span>
          <textarea value={task} onChange={(event) => setTask(event.target.value)} />
        </label>
        <div className="task-intent-panel">
          <div className="intent-heading">
            <span>Parsed intent</span>
            <strong className={`execution-mode ${executionMode}`}>
              {executionMode === "mcp-gateway" ? "REAL MCP" : executionMode === "local-fallback" ? "LOCAL FALLBACK" : "GATEWAY READY"}
            </strong>
          </div>
          <div className="compact-list">
            <span>Objective: {parsedIntent.objective}</span>
            <span>Sensitivity: {labelMap[parsedIntent.sensitivity_variable]}</span>
            <span>Steps: {parsedIntent.sensitivity_steps}</span>
            <span>Fallback: {parsedIntent.use_fallback ? "enabled" : "optional"}</span>
          </div>
          <small className="execution-note">{executionNote}</small>
        </div>
        <WorkflowProgress status={workflowStatus} progress={workflowProgress} />
        <div className="agent-visual-grid">
          <article>
            <img src="/assets/agent-workflow.svg" alt="PCM agent workflow diagram" />
            <strong>Agent workflow</strong>
            <span>Validation, prediction, sensitivity, optimization, and report generation.</span>
          </article>
          <article>
            <img src="/assets/evidence-audit.svg" alt="Nearest evidence audit visualization" />
            <strong>Evidence audit</strong>
            <span>Distance, weight, and evidence type behind each decision.</span>
          </article>
        </div>
      </Panel>

      <div className="agent-main-grid">
        <div className="agent-left">
          <Panel title="Active scenario">
            <ScenarioMiniControls
              options={options}
              ranges={ranges}
              scenario={scenario}
              updateScenario={updateScenario}
            />
            <div className="agent-controls">
              <label className="field">
                <span>Optimization objective</span>
                <select value={objective} onChange={(event) => setObjective(event.target.value)}>
                  <option value="balance">Balanced decision</option>
                  <option value="stored_energy">Max stored energy</option>
                  <option value="efficiency">Max efficiency</option>
                  <option value="loss">Min loss</option>
                  <option value="health">Max health</option>
                </select>
              </label>
              <label className="field">
                <span>Sensitivity variable</span>
                <select value={sensitivityVariable} onChange={(event) => setSensitivityVariable(event.target.value)}>
                  {[
                    "air_temperature_c",
                    "solar_irradiance_wm2",
                    "inlet_fluid_temp_c",
                    "melting_point_c",
                    "pcm_mass_kg",
                    "mass_flow_rate_kgs",
                    "cycle_number",
                  ].map((option) => (
                    <option key={option} value={option}>{labelMap[option]}</option>
                  ))}
                </select>
              </label>
            </div>
            <PresetStrip title="Scenario templates" items={SCENARIO_TEMPLATES} onApply={applyScenarioPreset} />
            <PresetStrip title="Failure mode simulator" items={FAILURE_MODES} onApply={applyScenarioPreset} compact />
          </Panel>

          <Panel title="Optimization constraints">
            <div className="constraint-grid">
              <label className="field">
                <span>Minimum data support (0--100)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={constraints.min_data_support}
                  onChange={(event) => updateConstraint("min_data_support", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Maximum loss (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={constraints.max_energy_loss_pct}
                  onChange={(event) => updateConstraint("max_energy_loss_pct", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Minimum SOC (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={constraints.min_soc_pct}
                  onChange={(event) => updateConstraint("min_soc_pct", Number(event.target.value))}
                />
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={constraints.only_direct_evidence}
                  onChange={(event) => updateConstraint("only_direct_evidence", event.target.checked)}
                />
                <span>Context-supported branch only</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={constraints.allow_extensions}
                  onChange={(event) => updateConstraint("allow_extensions", event.target.checked)}
                />
                <span>Allow scenario extensions</span>
              </label>
            </div>
          </Panel>

          <Panel title="Analysis workflow trace">
            <div className="workflow-timeline">
              {agentRunSteps.map(([name, detail], index) => (
                <article className={`workflow-step ${stepStatus[name]}`} key={name}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{name}</strong>
                    <p>{detail}</p>
                    <small>status: {stepStatus[name]}</small>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="MCP tool-call preview">
            <div className="tool-call-list">
              {toolCallPreview.map((item) => (
                <article key={item.tool}>
                  <span>{item.tool}</span>
                  <code>{item.call}</code>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="MCP benchmark">
            <div className="benchmark-grid">
              <MetricFlag label="Tool discovery" value={benchmark.tool_discovery_success} note="registered tools" tone="teal" />
              <MetricFlag label="Resources" value={benchmark.resource_retrieval_success} note="summary, schema, guide, benchmark" tone="ink" />
              <MetricFlag label="Malformed input" value={benchmark.malformed_input_rejection} note="invalid scenario rejection" tone="rose" />
              <MetricFlag label="Report workflow" value={benchmark.report_generation_success} note="decision package generated" tone="amber" />
            </div>
          </Panel>

          <Panel title="Run history">
            <div className="history-list">
              {runHistory.length ? (
                runHistory.map((entry) => (
                  <article className="history-card" key={entry.id}>
                    <div>
                      <strong>{entry.best_candidate}</strong>
                      <span>{entry.timestamp}</span>
                      <p>{entry.task}</p>
                    </div>
                    <button className="secondary-button" onClick={() => exportHistoryPackage(entry)}>
                      Export
                    </button>
                    <small>Scenario support {entry.scenario_support_score}/100 · {entry.system_type}</small>
                  </article>
                ))
              ) : (
                <div className="agent-note">Run a workflow to save a local decision history entry.</div>
              )}
            </div>
            {runHistory.length >= 2 && (
              <div className="history-compare-controls">
                <select value={compareRuns.a} onChange={(event) => setCompareRuns((current) => ({ ...current, a: event.target.value }))}>
                  <option value="">Compare run A</option>
                  {runHistory.map((entry) => <option key={entry.id} value={entry.id}>{entry.timestamp}</option>)}
                </select>
                <select value={compareRuns.b} onChange={(event) => setCompareRuns((current) => ({ ...current, b: event.target.value }))}>
                  <option value="">Compare run B</option>
                  {runHistory.map((entry) => <option key={entry.id} value={entry.id}>{entry.timestamp}</option>)}
                </select>
              </div>
            )}
            {runComparison && <RunComparison comparison={runComparison} />}
          </Panel>
        </div>

        <div className="agent-right">
          <div className="kpi-grid">
            <MetricFlag
              label="Scenario support"
              value={`${round(validation.scenario_support_score, 1)}/100`}
              note={`${validation.evidence_level} evidence, ${validation.validity_status}`}
              tone={validation.scenario_support_score >= 75 ? "teal" : "amber"}
            />
            <MetricFlag
              label="Data support"
              value={explanation ? `${round(explanation.prediction.data_support_score, 1)}/100` : "Pending"}
              note={explanation ? `${explanation.prediction.sample_size} nearby records` : "Run workflow to compute"}
              tone="ink"
            />
            <MetricFlag
              label="Best design score"
              value={optimization?.top_candidates[0]?.score ?? "Pending"}
              note={optimization?.top_candidates[0]?.combination ?? "Run workflow to rank candidates"}
              tone="teal"
            />
            <MetricFlag
              label="Sensitivity best"
              value={sensitivity ? round(sensitivity.best_point.score, 1) : "Pending"}
              note={sensitivity ? `${sensitivity.label}: ${round(sensitivity.best_point.value, 2)}` : "Run workflow to scan"}
              tone="amber"
            />
          </div>

          <Panel title="Scenario validation and risk flags">
            <div className="agent-validation">
              <div className={`validation-badge ${validation.is_valid ? "valid" : "risk"}`}>
                <strong>{validation.is_valid ? "Supported scenario" : "Fallback required"}</strong>
                <span>{validation.evidence_generation}</span>
              </div>
              <div className="diagnostic-list">
                {(validation.warnings.length ? validation.warnings : ["Scenario is inside the current data support envelope."]).map((warning) => (
                  <div className={`diagnostic ${validation.warnings.length ? "warning" : "good"}`} key={warning}>
                    <span>{validation.warnings.length ? "Watch" : "Good"}</span>
                    <div>
                      <strong>{warning}</strong>
                      <p>Support scores and fallback logic are included in the exported decision package.</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {decisionTrace.length > 0 && (
            <Panel title="Decision rationale trace">
              <DecisionTrace items={decisionTrace} />
            </Panel>
          )}

          {quality && (
            <Panel title="Scenario quality score decomposition">
              <div className="module-visual result-visual">
                <img src="/assets/quality-decomposition.svg" alt="Scenario quality score decomposition explainer" />
              </div>
              <QualityDecomposition quality={quality} />
            </Panel>
          )}

          {fallbackComparison && (
            <Panel title="Original vs fallback scenario">
              <FallbackComparison comparison={fallbackComparison} />
            </Panel>
          )}

          {riskMap.length > 0 && (
            <Panel title="Decision risk map">
              <div className="module-visual result-visual">
                <img src="/assets/risk-map-explainer.svg" alt="Decision risk map explainer" />
              </div>
              <RiskMap items={riskMap} />
            </Panel>
          )}

          {explanation ? (
            <>
              <Panel title="Evidence-audited prediction">
                <div className="prediction-grid">
                  <MetricFlag label="Efficiency" value={`${round(explanation.prediction.thermal_storage_efficiency_pct, 1)}%`} note={explanation.saturation_audit.status} tone="teal" />
                  <MetricFlag label="Stored energy" value={`${round(explanation.prediction.stored_energy_kj, 0)} kJ`} note="similarity estimator" tone="ink" />
                  <MetricFlag label="SOC" value={`${round(explanation.prediction.state_of_charge_pct, 1)}%`} note="predicted state" tone="amber" />
                  <MetricFlag label="Energy loss" value={`${round(explanation.prediction.energy_loss_pct, 1)}%`} note="risk diagnosis input" tone="rose" />
                </div>
                <div className="agent-split">
                  <div>
                    <h3>Key input gaps</h3>
                    <div className="compact-list">
                      {explanation.key_influences.slice(0, 4).map((item) => (
                        <span key={item.variable}>{item.label}: {round(item.normalized_gap, 3)}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>Saturation audit</h3>
                    <div className="compact-list">
                      <span>98% cap: {explanation.saturation_audit.cap_98_share_pct}%</span>
                      <span>35% floor: {explanation.saturation_audit.floor_35_share_pct}%</span>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Nearest evidence records">
                <WeightedEvidenceTable rows={explanation.evidence_audit.nearest_records} />
              </Panel>

              <Panel title="Evidence cluster view">
                <EvidenceCluster points={evidenceCluster} />
              </Panel>
            </>
          ) : (
            <Panel title="Evidence-audited prediction">
              <div className="agent-note">
                Click Run workflow to call the MCP-style decision chain and populate prediction evidence, weighted nearest records, sensitivity, optimization, and the exportable decision package.
              </div>
            </Panel>
          )}

          {sensitivity && optimization && (
            <div className="two-col">
              <Panel title="Sensitivity scan">
                <SensitivityChart points={sensitivity.sweep} label={sensitivity.label} />
                <div className="agent-note">
                  Best point: {sensitivity.label} = {round(sensitivity.best_point.value, 2)}, score {round(sensitivity.best_point.score, 1)}.
                </div>
              </Panel>
              <Panel title="Optimization candidates">
                <div className="candidate-list">
                  {optimization.top_candidates.slice(0, 5).map((candidate, index) => (
                    <article className="candidate-card" key={candidate.combination}>
                      <span>#{index + 1}</span>
                      <strong>{candidate.combination}</strong>
                      <p>
                        Score {round(candidate.score, 1)} · Eff {round(candidate.efficiency_pct, 1)}% ·
                        Stored {round(candidate.stored_energy_kj, 0)} kJ · Data support {round(candidate.data_support_score, 0)}/100
                      </p>
                    </article>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          {constrainedOptimization && (
            <Panel title="Constraint-aware optimization">
              <div className="module-visual result-visual">
                <img src="/assets/constraint-optimization.svg" alt="Constraint-aware optimization explainer" />
              </div>
              <ConstraintOptimization result={constrainedOptimization} />
            </Panel>
          )}

          {multiSensitivity && modelComparison.length > 0 && (
            <div className="two-col">
              <Panel title="Multi-variable sensitivity">
                <InfluenceRanking ranking={multiSensitivity.ranking} />
              </Panel>
              <Panel title="Model comparison">
                <div className="module-visual result-visual">
                  <img src="/assets/model-comparison.svg" alt="Model comparison explainer" />
                </div>
                <ModelComparison rows={modelComparison} />
              </Panel>
            </div>
          )}

          {(counterfactuals.length > 0 || uncertaintyDrivers.length > 0) && (
            <div className="two-col">
              <Panel title="Counterfactual recommendations">
                <CounterfactualCards items={counterfactuals} />
              </Panel>
              <Panel title="Uncertainty drivers">
                <UncertaintyDrivers items={uncertaintyDrivers} />
              </Panel>
            </div>
          )}

          <Panel title="Cloud platform extension path">
            <div className="cloud-extension-grid">
              <article>
                <span>Project workspace</span>
                <strong>Local history now, database later</strong>
                <p>Building envelope, SolarTES, and battery-cooling cases can become saved project spaces.</p>
              </article>
              <article>
                <span>Scenario upload</span>
                <strong>Scenario JSON / CSV ingestion</strong>
                <p>The same MCP workflow can be reused after adding upload validation and dataset versioning.</p>
              </article>
              <article>
                <span>Cloud audit log</span>
                <strong>User, input, tool chain, output</strong>
                <p>Each workflow run can be persisted to PostgreSQL or Supabase for formal review.</p>
              </article>
            </div>
          </Panel>

          <Panel title="Decision package preview">
            <pre className="code-block small-code">{JSON.stringify(
              packageResult
                ? {
                    version: packageResult.version,
                    workflow_status: packageResult.workflow_status,
                    scenario_support_score: packageResult.scenario_validation.scenario_support_score,
                    evidence_level: packageResult.scenario_validation.evidence_level,
                    best_candidate: packageResult.optimization.top_candidates[0]?.combination,
                    report: packageResult.report,
                  }
                : {
                    workflow_status: "queued",
                    next_action: "Click Run workflow",
                    current_scenario_support_score: validation.scenario_support_score,
                    evidence_level: validation.evidence_level,
                  },
              null,
              2,
            )}</pre>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function SensitivityChart({ points, label }) {
  const width = 620;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 42, left: 48 };
  const maxStored = Math.max(...points.map((point) => point.stored_energy_kj), 1);
  const minStored = Math.min(...points.map((point) => point.stored_energy_kj), 0);
  const x = (index) =>
    padding.left + (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const yStored = (value) =>
    padding.top +
    (1 - (value - minStored) / Math.max(maxStored - minStored, 1)) *
      (height - padding.top - padding.bottom);
  const yPct = (value) =>
    padding.top + (1 - Math.max(0, Math.min(100, value)) / 100) * (height - padding.top - padding.bottom);
  const line = (fn) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${fn(point)}`).join(" ");

  return (
    <div className="sensitivity-wrap">
      <svg className="sensitivity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Sensitivity scan for ${label}`}>
        <line x1={padding.left} x2={width - padding.right} y1={yPct(0)} y2={yPct(0)} />
        <line x1={padding.left} x2={width - padding.right} y1={yPct(50)} y2={yPct(50)} />
        <line x1={padding.left} x2={width - padding.right} y1={yPct(100)} y2={yPct(100)} />
        <path className="profile-line teal-line" d={line((point) => yPct(point.efficiency_pct))} />
        <path className="profile-line amber-line" d={line((point) => yPct(point.soc_pct))} />
        <path className="profile-line ink-line" d={line((point) => yStored(point.stored_energy_kj))} />
        {points.map((point, index) => (
          <React.Fragment key={point.value}>
            <circle className="sensitivity-dot" cx={x(index)} cy={yPct(point.efficiency_pct)} r="4" />
            {index % 2 === 0 && (
              <text x={x(index)} y={height - 14}>
                {round(point.value, Math.abs(point.value) > 100 ? 0 : 1)}
              </text>
            )}
          </React.Fragment>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-teal" /> Efficiency</span>
        <span><i className="legend-amber" /> SOC</span>
        <span><i className="legend-bar" /> Stored energy</span>
      </div>
    </div>
  );
}

function WorkflowProgress({ status, progress }) {
  const active = status === "running";
  const done = status === "completed";
  return (
    <div className={`workflow-progress ${active ? "running" : ""} ${done ? "done" : ""}`}>
      <div className="progress-header">
        <div>
          <strong>{progress.current}</strong>
          <span>{active ? `Elapsed ${progress.elapsed}s` : done ? `Completed in ${progress.elapsed}s` : "Ready to run"}</span>
        </div>
        <b>{progress.percent}%</b>
      </div>
      <div className="progress-track">
        <span style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
      </div>
      {active && (
        <p>
          Full analysis scans thousands of evidence comparisons. The interface updates after each completed stage.
        </p>
      )}
      {progress.log.length > 0 && (
        <div className="progress-log">
          {progress.log.slice(0, 4).map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function PresetStrip({ title, items, onApply, compact = false }) {
  return (
    <div className={compact ? "preset-strip compact" : "preset-strip"}>
      <span>{title}</span>
      <div>
        {items.map((item) => (
          <button className="secondary-button" key={item.id} onClick={() => onApply(item)}>
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function DecisionTrace({ items }) {
  return (
    <div className="reasoning-list">
      {items.map((item, index) => (
        <article key={item.step}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.step}</strong>
            <p>{item.rationale}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function QualityDecomposition({ quality }) {
  return (
    <div className="quality-panel">
      <MetricFlag label="Final support" value={`${quality.final_support_score}/100`} note="Scenario support" tone="teal" />
      <div className="quality-list">
        {quality.components.map((item) => (
          <article key={item.key}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <div className="bar-track">
              <span className="teal" style={{ width: `${Math.max(4, item.score)}%` }} />
            </div>
            <em>{item.score}</em>
          </article>
        ))}
        {quality.penalties.map((item) => (
          <article className="penalty" key={item.key}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <div className="bar-track">
              <span className="rose" style={{ width: `${Math.max(4, item.value)}%` }} />
            </div>
            <em>-{item.value}</em>
          </article>
        ))}
      </div>
    </div>
  );
}

function ConstraintOptimization({ result }) {
  return (
    <div className="constraint-result">
      <div className="compact-list">
        <span>Min data support: {result.constraints.min_data_support}/100</span>
        <span>Max loss: {result.constraints.max_energy_loss_pct}%</span>
        <span>Min SOC: {result.constraints.min_soc_pct}%</span>
        <span>Context-supported only: {result.constraints.only_direct_evidence ? "yes" : "no"}</span>
      </div>
      <div className="two-col">
        <div>
          <h3>Feasible candidates</h3>
          <div className="candidate-list">
            {(result.feasible.length ? result.feasible : [{ combination: "No feasible candidate", score: 0, data_support_score: 0, efficiency_pct: 0, stored_energy_kj: 0 }]).slice(0, 4).map((candidate) => (
              <article className="candidate-card" key={candidate.combination}>
                <span>OK</span>
                <strong>{candidate.combination}</strong>
                <p>Score {round(candidate.score, 1)} · Data support {round(candidate.data_support_score, 0)}/100 · Eff {round(candidate.efficiency_pct, 1)}%</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Rejected candidates</h3>
          <div className="candidate-list">
            {result.rejected.slice(0, 4).map((candidate) => (
              <article className="candidate-card rejected" key={candidate.combination}>
                <span>No</span>
                <strong>{candidate.combination}</strong>
                <p>{candidate.rejection_reasons.join(", ")}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidenceCluster({ points }) {
  const width = 760;
  const height = 230;
  const padding = { left: 44, right: 24, top: 24, bottom: 34 };
  const maxDistance = Math.max(...points.map((point) => point.normalized_distance), 1);
  const x = (distance) => padding.left + (distance / maxDistance) * (width - padding.left - padding.right);
  const y = (index) => padding.top + (index / Math.max(points.length - 1, 1)) * (height - padding.top - padding.bottom);

  return (
    <div className="evidence-cluster-wrap">
      <svg className="evidence-cluster" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evidence cluster by distance and weight">
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
        {points.map((point, index) => (
          <g key={`${point.rank}-${point.timestamp}`}>
            <circle
              className={`cluster-dot ${point.color_metric}`}
              cx={x(point.normalized_distance)}
              cy={y(index)}
              r={point.radius}
            />
            <text x={x(point.normalized_distance)} y={y(index) - point.radius - 5}>#{point.rank}</text>
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-teal" /> High efficiency</span>
        <span><i className="legend-amber" /> SOC driven</span>
        <span><i className="legend-rose" /> High loss</span>
      </div>
    </div>
  );
}

function CounterfactualCards({ items }) {
  return (
    <div className="counterfactual-list">
      {items.map((item) => (
        <article key={item.question}>
          <span>{item.question}</span>
          <p>{item.answer}</p>
        </article>
      ))}
    </div>
  );
}

function UncertaintyDrivers({ items }) {
  return (
    <div className="uncertainty-driver-list">
      {items.map((item) => (
        <article className={item.level.toLowerCase()} key={item.driver}>
          <span>{item.level}</span>
          <strong>{item.driver}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

function RunComparison({ comparison }) {
  return (
    <div className="run-comparison">
      <DeltaCard label="Data support" value={comparison.data_support_delta} suffix=" points" positiveIsGood />
      <DeltaCard label="Stored energy" value={comparison.stored_delta} suffix=" kJ" positiveIsGood />
      <DeltaCard label="Efficiency" value={comparison.efficiency_delta} suffix="%" positiveIsGood />
      <DeltaCard label="Risk changes" value={comparison.risk_delta_count} suffix="" />
      <div className="agent-note">Candidate A: {comparison.a_candidate} · Candidate B: {comparison.b_candidate}</div>
    </div>
  );
}

function RiskMap({ items }) {
  return (
    <div className="risk-map-grid">
      {items.map((item) => (
        <article className={`risk-map-card ${item.level.toLowerCase()}`} key={item.key}>
          <span>{item.level}</span>
          <strong>{item.label}</strong>
          <p>{item.evidence}</p>
        </article>
      ))}
    </div>
  );
}

function InfluenceRanking({ ranking }) {
  const max = Math.max(...ranking.map((item) => item.impact_strength), 1);
  return (
    <div className="influence-list">
      {ranking.map((item, index) => (
        <article key={item.variable}>
          <div>
            <span>#{index + 1}</span>
            <strong>{item.label}</strong>
            <small>Best {round(item.best_value, 2)} · score {round(item.best_score, 1)}</small>
          </div>
          <div className="bar-track">
            <span className="teal" style={{ width: `${Math.max(4, (item.impact_strength / max) * 100)}%` }} />
          </div>
          <em>{round(item.impact_strength, 1)}</em>
        </article>
      ))}
    </div>
  );
}

function ModelComparison({ rows }) {
  return (
    <div className="model-comparison-list">
      {rows.map((item) => (
        <article className={item.status === "active" ? "active" : ""} key={item.model}>
          <div>
            <strong>{item.model}</strong>
            <span>{item.status}</span>
          </div>
          <dl>
            <div><dt>Interpretability</dt><dd>{item.interpretability}</dd></div>
            <div><dt>Evidence</dt><dd>{item.evidence_records}</dd></div>
            <div><dt>Data support</dt><dd>{item.data_support_score ? `${item.data_support_score}/100` : "N/A"}</dd></div>
          </dl>
          {item.prediction ? (
            <p>
              Eff {round(item.prediction.thermal_storage_efficiency_pct, 1)}% ·
              Stored {round(item.prediction.stored_energy_kj, 0)} kJ ·
              SOC {round(item.prediction.state_of_charge_pct, 1)}%
            </p>
          ) : (
            <p>Requires a separate trained model service.</p>
          )}
        </article>
      ))}
    </div>
  );
}

function FallbackComparison({ comparison }) {
  const delta = comparison.delta_from_original_to_fallback;
  const changed = comparison.changed_variables;

  return (
    <div className="fallback-panel">
      <div className={`validation-badge ${comparison.used_fallback ? "risk" : "valid"}`}>
        <strong>{comparison.used_fallback ? "Fallback changes applied" : "No fallback needed"}</strong>
        <span>
          {comparison.used_fallback
            ? "The fallback scenario clamps unsupported or out-of-range inputs before prediction."
            : "The active scenario is already inside the current support envelope."}
        </span>
      </div>
      <div className="fallback-change-list">
        {changed.length ? (
          changed.map((item) => (
            <article key={item.variable}>
              <span>{item.label}</span>
              <strong>{String(item.original)}{" -> "}{String(item.fallback)}</strong>
            </article>
          ))
        ) : (
          <article>
            <span>Changed variables</span>
            <strong>None</strong>
          </article>
        )}
      </div>
      <div className="whatif-grid fallback-deltas">
        <DeltaCard label="Efficiency" value={delta.efficiency} suffix="%" positiveIsGood />
        <DeltaCard label="Stored energy" value={delta.stored} suffix=" kJ" positiveIsGood />
        <DeltaCard label="SOC" value={delta.soc} suffix="%" positiveIsGood />
        <DeltaCard label="Energy loss" value={delta.loss} suffix="%" />
        <DeltaCard label="Phase fraction" value={delta.phase * 100} suffix="%" positiveIsGood />
      </div>
    </div>
  );
}

function WeightedEvidenceTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Weight</th>
            <th>Distance</th>
            <th>Timestamp</th>
            <th>PCM</th>
            <th>System</th>
            <th>Encapsulation</th>
            <th>Efficiency</th>
            <th>SOC</th>
            <th>Stored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.rank}-${row.timestamp}`}>
              <td>{row.rank}</td>
              <td>{round(row.weight_pct, 2)}%</td>
              <td>{round(row.normalized_distance, 4)}</td>
              <td>{row.timestamp}</td>
              <td>{row.pcm_type}</td>
              <td>{row.system_type}</td>
              <td>{row.encapsulation_type}</td>
              <td>{round(row.efficiency_pct, 1)}%</td>
              <td>{round(row.soc_pct, 1)}%</td>
              <td>{round(row.stored_energy_kj, 0)} kJ</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthCard({ health }) {
  return (
    <div className="health-card">
      <div className="health-score">
        <div className="health-ring" style={{ "--value": `${health.score * 3.6}deg` }}>
          <strong>{round(health.score, 0)}</strong>
        </div>
        <div>
          <span>Health status</span>
          <h3>{health.status}</h3>
          <p>Index combines predicted degradation, energy loss, cycle ageing, SOC reserve, and phase activation.</p>
        </div>
      </div>
      <div className="health-drivers">
        {health.drivers.map((driver) => (
          <div className="driver-row" key={driver.label}>
            <span>{driver.label}</span>
            <strong>{round(driver.value, driver.label === "Degradation" ? 3 : 1)}{driver.unit}</strong>
            <div className="driver-track">
              <em style={{ width: `${Math.min(100, driver.risk * 3)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScenarioMiniControls({ options, ranges, scenario, updateScenario }) {
  return (
    <div className="mini-controls">
      <div className="select-grid">
        {["pcm_type", "system_type", "encapsulation_type"].map((key) => (
          <label className="field" key={key}>
            <span>{labelMap[key]}</span>
            <select value={scenario[key]} onChange={(event) => updateScenario(key, event.target.value)}>
              {options[key].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mini-slider-grid">
        {[
          "air_temperature_c",
          "solar_irradiance_wm2",
          "inlet_fluid_temp_c",
          "melting_point_c",
          "pcm_mass_kg",
          "mass_flow_rate_kgs",
          "cycle_number",
        ].map((key) => (
          <RangeField
            key={key}
            field={key}
            range={ranges[key]}
            value={scenario[key]}
            onChange={(value) => updateScenario(key, value)}
          />
        ))}
      </div>
    </div>
  );
}

function DeltaCard({ label, value, suffix, positiveIsGood = false }) {
  const good = positiveIsGood ? value >= 0 : value <= 0;
  const signed = value > 0 ? `+${round(value, Math.abs(value) > 10 ? 0 : 1)}` : `${round(value, Math.abs(value) > 10 ? 0 : 1)}`;
  return (
    <div className={`delta-card ${good ? "good" : "risk"}`}>
      <span>{label}</span>
      <strong>{signed}{suffix}</strong>
      <small>{good ? "Improves target" : "Watch trade-off"}</small>
    </div>
  );
}

function PredictionSummary({ title, prediction }) {
  return (
    <article className="prediction-summary">
      <h3>{title}</h3>
      <dl>
        <div><dt>Efficiency</dt><dd>{round(prediction.thermal_storage_efficiency_pct, 1)}%</dd></div>
        <div><dt>Stored</dt><dd>{round(prediction.stored_energy_kj, 0)} kJ</dd></div>
        <div><dt>SOC</dt><dd>{round(prediction.state_of_charge_pct, 1)}%</dd></div>
        <div><dt>Loss</dt><dd>{round(prediction.energy_loss_pct, 1)}%</dd></div>
      </dl>
    </article>
  );
}

function FitHeatmap({ matrix }) {
  return (
    <div className="fit-heatmap">
      <div className="heatmap-head" />
      {matrix.encapsulations.map((encapsulation) => (
        <strong className="heatmap-label top" key={encapsulation}>{encapsulation}</strong>
      ))}
      {matrix.pcmTypes.map((pcm) => (
        <React.Fragment key={pcm}>
          <strong className="heatmap-label side">{pcm}</strong>
          {matrix.encapsulations.map((encapsulation) => {
            const cell = matrix.cells.find((item) => item.pcm === pcm && item.encapsulation === encapsulation);
            return (
              <div
                className="heat-cell"
                key={`${pcm}-${encapsulation}`}
                style={{ "--heat": cell?.score ?? 0 }}
                title={`${pcm} / ${encapsulation}`}
              >
                <strong>{round((cell?.score ?? 0) * 100, 0)}</strong>
                <span>{cell?.group ? `${round(cell.group.efficiency, 1)}% eff` : "No data"}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function UncertaintyPanel({ intervals, prediction }) {
  const rows = [
    ["Efficiency", "thermal_storage_efficiency_pct", "%"],
    ["Stored energy", "stored_energy_kj", " kJ"],
    ["SOC", "state_of_charge_pct", "%"],
    ["Energy loss", "energy_loss_pct", "%"],
    ["Phase fraction", "phase_fraction", ""],
  ];

  return (
    <div className="uncertainty-list">
      {rows.map(([label, key, suffix]) => {
        const interval = intervals[key];
        const current = prediction[key];
        const min = interval.p10;
        const max = interval.p90;
        const left = max === min ? 50 : ((current - min) / (max - min)) * 100;
        return (
          <div className="uncertainty-row" key={key}>
            <div>
              <strong>{label}</strong>
              <span>P10 {formatValue(min, suffix)} · P50 {formatValue(interval.p50, suffix)} · P90 {formatValue(max, suffix)}</span>
            </div>
            <div className="uncertainty-track">
              <em />
              <i style={{ left: `${Math.max(0, Math.min(100, left))}%` }} />
            </div>
            <b>{formatValue(current, suffix)}</b>
          </div>
        );
      })}
    </div>
  );
}

function AdviceList({ advice }) {
  return (
    <div className="advice-list">
      {advice.map((item) => (
        <article className="advice-card" key={`${item.mode}-${item.impact}`}>
          <span>{item.impact}</span>
          <strong>{item.mode}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

function EvidenceTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>PCM</th>
            <th>System</th>
            <th>Encapsulation</th>
            <th>Efficiency</th>
            <th>SOC</th>
            <th>Stored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.timestamp}-${row.cycle_number}`}>
              <td>{row.timestamp}</td>
              <td>{row.pcm_type}</td>
              <td>{row.system_type}</td>
              <td>{row.encapsulation_type}</td>
              <td>{round(row.thermal_storage_efficiency_pct, 1)}%</td>
              <td>{round(row.state_of_charge_pct, 1)}%</td>
              <td>{round(row.stored_energy_kj, 0)} kJ</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HourlyProfileChart({ profile }) {
  const width = 920;
  const height = 280;
  const padding = { top: 20, right: 22, bottom: 34, left: 42 };
  const xStep = (width - padding.left - padding.right) / 23;
  const y = (value) =>
    padding.top + (1 - Math.max(0, Math.min(100, value)) / 100) * (height - padding.top - padding.bottom);
  const x = (hour) => padding.left + hour * xStep;
  const linePath = (key) =>
    profile
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.hour)} ${y(point[key])}`)
      .join(" ");

  const storedMax = Math.max(...profile.map((point) => point.stored), 1);

  return (
    <div className="profile-chart-wrap">
      <svg className="profile-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24-hour operating profile">
        <line x1={padding.left} x2={width - padding.right} y1={y(0)} y2={y(0)} />
        <line x1={padding.left} x2={width - padding.right} y1={y(50)} y2={y(50)} />
        <line x1={padding.left} x2={width - padding.right} y1={y(100)} y2={y(100)} />
        {profile.map((point) => {
          const barHeight = (point.stored / storedMax) * 88;
          return (
            <rect
              className="profile-bar"
              key={point.hour}
              x={x(point.hour) - 8}
              y={height - padding.bottom - barHeight}
              width="16"
              height={barHeight}
              rx="3"
            />
          );
        })}
        <path className="profile-line teal-line" d={linePath("efficiency")} />
        <path className="profile-line amber-line" d={linePath("soc")} />
        {profile.filter((point) => point.hour % 3 === 0).map((point) => (
          <text key={point.hour} x={x(point.hour)} y={height - 10}>{String(point.hour).padStart(2, "0")}</text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-teal" /> Efficiency</span>
        <span><i className="legend-amber" /> SOC</span>
        <span><i className="legend-bar" /> Stored energy</span>
      </div>
    </div>
  );
}

function KpiGrid({ summary }) {
  const cards = [
    ["Records", formatNumber(summary.count), "Hourly PCM operation rows"],
    ["Time span", `${summary.start.slice(0, 4)}-${summary.end.slice(0, 4)}`, "Dataset coverage"],
    ["Stored energy", `${round(summary.stored.mean, 0)} kJ`, "Average stored energy"],
    ["SOC", `${round(summary.soc.mean, 1)}%`, "Average state of charge"],
  ];
  return (
    <div className="kpi-grid">
      {cards.map(([label, value, note]) => (
        <MetricFlag key={label} label={label} value={value} note={note} tone="ink" />
      ))}
    </div>
  );
}

function Panel({ title, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Status({ value, label, tone }) {
  return (
    <div className={`status ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MetricFlag({ label, value, note, tone }) {
  return (
    <div className={`metric-flag ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function BarList({ rows, valueKey, suffix, color }) {
  const max = Math.max(...rows.map((row) => row[valueKey]), 1);
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <div className="bar-label">
            <strong>{row.key}</strong>
            <span>{formatNumber(row.count)} rows</span>
          </div>
          <div className="bar-track">
            <span className={color} style={{ width: `${Math.max(3, (row[valueKey] / max) * 100)}%` }} />
          </div>
          <em>{round(row[valueKey], valueKey === "stored" ? 0 : 1)}{suffix}</em>
        </div>
      ))}
    </div>
  );
}

function BandChart({ rows }) {
  const max = Math.max(...rows.map((row) => row.efficiency), 1);
  return (
    <div className="band-chart">
      {rows.map((row) => (
        <div className="band" key={row.key}>
          <div className="band-column" style={{ height: `${Math.max(18, (row.efficiency / max) * 170)}px` }}>
            <span>{round(row.efficiency, 0)}%</span>
          </div>
          <strong>{row.key}</strong>
          <small>SOC {round(row.soc, 1)}% · phase {round(row.phase * 100, 1)}%</small>
        </div>
      ))}
    </div>
  );
}

function DataTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Combination</th>
            <th>Rows</th>
            <th>Efficiency</th>
            <th>Stored energy</th>
            <th>SOC</th>
            <th>Loss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{formatNumber(row.count)}</td>
              <td>{round(row.efficiency, 1)}%</td>
              <td>{round(row.stored, 0)} kJ</td>
              <td>{round(row.soc, 1)}%</td>
              <td>{round(row.loss, 1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(([option, label]) => (
        <button
          key={option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RangeField({ field, range, value, onChange }) {
  if (!range) return null;
  const step = Math.max((range.max - range.min) / 250, 0.001);
  return (
    <label className="range-field">
      <span>
        <strong>{labelMap[field]}</strong>
        <em>{round(value, field.includes("conductivity") || field.includes("flow") ? 3 : 2)}</em>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Gauge({ label, value, suffix, tone }) {
  const clipped = Math.max(0, Math.min(100, value));
  return (
    <div className={`gauge ${tone}`}>
      <div className="gauge-ring" style={{ "--value": `${clipped * 3.6}deg` }}>
        <strong>{round(value, 1)}{suffix}</strong>
      </div>
      <span>{label}</span>
    </div>
  );
}

function mean(rows, column) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row[column], 0) / rows.length;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatValue(value, suffix) {
  const digits = suffix === " kJ" ? 0 : suffix === "" ? 3 : 1;
  return `${round(value, digits)}${suffix}`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function loadAgentHistory() {
  try {
    const raw = window.localStorage.getItem("pcm-agent-run-history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistoryEntry(packageResult, task, setRunHistory) {
  const entry = {
    id: Date.now(),
    timestamp: new Date().toLocaleString(),
    task,
    scenario: packageResult.report.scenario,
    system_type: packageResult.report.scenario.system_type,
    scenario_support_score: packageResult.scenario_validation.scenario_support_score,
    best_candidate: packageResult.optimization.top_candidates[0]?.combination ?? "No candidate",
    package: packageResult,
  };
  setRunHistory((current) => {
    const next = [entry, ...current].slice(0, 8);
    window.localStorage.setItem("pcm-agent-run-history", JSON.stringify(next));
    return next;
  });
}

function compareHistoryRuns(history, firstId, secondId) {
  if (!firstId || !secondId || firstId === secondId) return null;
  const first = history.find((entry) => String(entry.id) === String(firstId));
  const second = history.find((entry) => String(entry.id) === String(secondId));
  if (!first || !second) return null;
  const firstPrediction = first.package.report.prediction;
  const secondPrediction = second.package.report.prediction;
  const firstRisks = first.package.risk_map ?? [];
  const secondRisks = second.package.risk_map ?? [];
  const riskDeltaCount = secondRisks.filter((risk, index) => risk.level !== firstRisks[index]?.level).length;
  return {
    data_support_delta: round(second.scenario_support_score - first.scenario_support_score, 1),
    stored_delta: round(secondPrediction.stored_energy_kj - firstPrediction.stored_energy_kj, 0),
    efficiency_delta: round(secondPrediction.thermal_storage_efficiency_pct - firstPrediction.thermal_storage_efficiency_pct, 1),
    risk_delta_count: riskDeltaCount,
    a_candidate: first.best_candidate,
    b_candidate: second.best_candidate,
  };
}
