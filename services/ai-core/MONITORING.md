# Cloud Monitoring for the pipeline pipeline

This service emits a handful of custom metrics to Google Cloud Monitoring
(formerly Stackdriver) so the operator can alert on the things that
actually matter — failure rate, runaway durations, cost overrun, LLM
timeouts, circuit-breaker trips.

The metrics are emitted from `EmitTelemetryUseCase` when a
`CloudMonitoringEmitter` is injected via the application bootstrap. In
production set `MONITORING_PROJECT_ID` (typically the same as
`GCLOUD_PROJECT`). If the env var is missing the emitter becomes a no-op
and the worker behaviour is unchanged.

## Metrics emitted

All metric names are prefixed with `custom.googleapis.com/dochevi/`.

| Metric                                | Type        | Labels                          | Emitted when |
|---------------------------------------|-------------|---------------------------------|--------------|
| `pipeline_job_duration_seconds`       | GAUGE       | `jobType`, `finalStatus`        | `budget_completed`, `budget_failed` |
| `pipeline_job_total_cost_usd`         | GAUGE       | `jobType`                       | `budget_completed` |
| `pipeline_job_failure_rate`           | CUMULATIVE  | `error_type`                    | `budget_failed` |
| `cache_hit_rate`                      | GAUGE       | —                               | `cache_hit_rate_sample` |
| `circuit_breaker_open_count`          | CUMULATIVE  | —                               | `circuit_breaker_opened` |
| `llm_timeout_count`                   | CUMULATIVE  | `model`                         | `llm_timeout` |

The mapping from telemetry `event_type` to metric lives in
[`emit_telemetry_uc.py`](src/pipeline_telemetry/application/use_cases/emit_telemetry_uc.py).
Adding a new metric is a two-line change: add an `emit_*` helper to
`CloudMonitoringEmitter`, then route the new event_type from the
use-case.

## Setting up the worker

```
gcloud run jobs update ai-core-worker \
    --region europe-west1 \
    --update-env-vars MONITORING_PROJECT_ID=<your-project-id>
```

The Cloud Run Job service account needs the
`roles/monitoring.metricWriter` role:

```
gcloud projects add-iam-policy-binding <your-project-id> \
    --member="serviceAccount:<worker-sa>@<your-project-id>.iam.gserviceaccount.com" \
    --role="roles/monitoring.metricWriter"
```

## Alert policies (CLI recipes)

These are starting points — tune the thresholds and notification
channels to your SRE setup.

### Failure rate >10% over the last hour

```bash
gcloud alpha monitoring policies create \
    --display-name="Pipeline job failure rate >10% / 1h" \
    --combiner=OR \
    --condition-display-name="failure_rate_1h_gt_10pct" \
    --condition-threshold-value=0.1 \
    --condition-threshold-duration=300s \
    --condition-threshold-comparison=COMPARISON_GT \
    --condition-threshold-filter='
        metric.type="custom.googleapis.com/dochevi/pipeline_job_failure_rate"
        AND resource.type="global"
    ' \
    --condition-threshold-aggregations='
        alignmentPeriod=3600s,
        perSeriesAligner=ALIGN_RATE
    ' \
    --notification-channels=<channel-id>
```

### Job duration > 60 min

```bash
gcloud alpha monitoring policies create \
    --display-name="Pipeline job duration > 60 min" \
    --combiner=OR \
    --condition-display-name="duration_gt_3600s" \
    --condition-threshold-value=3600 \
    --condition-threshold-duration=0s \
    --condition-threshold-comparison=COMPARISON_GT \
    --condition-threshold-filter='
        metric.type="custom.googleapis.com/dochevi/pipeline_job_duration_seconds"
        AND resource.type="global"
    ' \
    --condition-threshold-aggregations='
        alignmentPeriod=60s,
        perSeriesAligner=ALIGN_MAX
    ' \
    --notification-channels=<channel-id>
```

### Cost > $10/job (sanity check)

```bash
gcloud alpha monitoring policies create \
    --display-name="Pipeline job cost > $10" \
    --combiner=OR \
    --condition-display-name="cost_gt_10usd" \
    --condition-threshold-value=10 \
    --condition-threshold-comparison=COMPARISON_GT \
    --condition-threshold-duration=0s \
    --condition-threshold-filter='
        metric.type="custom.googleapis.com/dochevi/pipeline_job_total_cost_usd"
        AND resource.type="global"
    ' \
    --condition-threshold-aggregations='
        alignmentPeriod=60s,
        perSeriesAligner=ALIGN_MAX
    ' \
    --notification-channels=<channel-id>
```

### Cache hit-rate < 30% for 30 min (degradation early-warning)

```bash
gcloud alpha monitoring policies create \
    --display-name="Cache hit-rate < 30% sustained 30min" \
    --combiner=OR \
    --condition-display-name="cache_hit_rate_low" \
    --condition-threshold-value=0.3 \
    --condition-threshold-comparison=COMPARISON_LT \
    --condition-threshold-duration=1800s \
    --condition-threshold-filter='
        metric.type="custom.googleapis.com/dochevi/cache_hit_rate"
        AND resource.type="global"
    ' \
    --condition-threshold-aggregations='
        alignmentPeriod=300s,
        perSeriesAligner=ALIGN_MEAN
    ' \
    --notification-channels=<channel-id>
```

### LLM timeout spike (>10 in 5 min)

```bash
gcloud alpha monitoring policies create \
    --display-name="LLM timeouts >10/5min" \
    --combiner=OR \
    --condition-display-name="llm_timeouts_spike" \
    --condition-threshold-value=10 \
    --condition-threshold-comparison=COMPARISON_GT \
    --condition-threshold-duration=300s \
    --condition-threshold-filter='
        metric.type="custom.googleapis.com/dochevi/llm_timeout_count"
        AND resource.type="global"
    ' \
    --condition-threshold-aggregations='
        alignmentPeriod=300s,
        perSeriesAligner=ALIGN_DELTA
    ' \
    --notification-channels=<channel-id>
```

## Notification channels

Discover available channel ids:

```bash
gcloud alpha monitoring channels list --format="table(displayName,name)"
```

Create an email channel from CLI (rare — usually configured once in the
console):

```bash
gcloud alpha monitoring channels create \
    --display-name="Ops on-call" \
    --type=email \
    --channel-labels=email_address=ops@yourcompany.example
```

## Verifying the metrics show up

After deploying with `MONITORING_PROJECT_ID` set, exercise the pipeline
(e.g. run an NL budget), then:

```bash
gcloud monitoring metrics list \
    --filter="metric.type:custom.googleapis.com/dochevi" \
    --format="table(metric.type)"
```

You should see entries appear within a minute of the first event.
Metric Explorer in the console will let you graph them immediately.

## Disabling

Simply unset `MONITORING_PROJECT_ID` (and re-deploy). The emitter falls
back to `enabled=False` and every `_maybe_emit_metric` call becomes a
no-op. Firestore-based telemetry continues to work exactly as before.
