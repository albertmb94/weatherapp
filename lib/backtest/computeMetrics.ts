/**
 * Compute verification metrics for weather forecasts.
 * MAE, RMSE, Bias for temperature and wind.
 * POD, FAR, CSI for precipitation (threshold: 0.1 mm/h).
 */

export interface MetricResult {
  mae: number | null
  rmse: number | null
  bias: number | null
  sampleCount: number
}

export interface PrecipitationMetricResult {
  mae: number | null
  rmse: number | null
  bias: number | null
  pod: number | null
  far: number | null
  csi: number | null
  sampleCount: number
}

const PRECIP_THRESHOLD = 0.1 // mm/h — threshold for "rain event"

/**
 * Compute MAE, RMSE, and Bias for continuous variables (temperature, wind).
 */
export function computeContinuousMetrics(
  predicted: number[],
  observed: number[]
): MetricResult {
  const n = Math.min(predicted.length, observed.length)
  if (n === 0) return { mae: null, rmse: null, bias: null, sampleCount: 0 }

  let sumAbsErr = 0
  let sumSqErr = 0
  let sumErr = 0

  for (let i = 0; i < n; i++) {
    const err = predicted[i] - observed[i]
    sumAbsErr += Math.abs(err)
    sumSqErr += err * err
    sumErr += err
  }

  return {
    mae: sumAbsErr / n,
    rmse: Math.sqrt(sumSqErr / n),
    bias: sumErr / n,
    sampleCount: n,
  }
}

/**
 * Compute precipitation metrics: MAE, RMSE, Bias, POD, FAR, CSI.
 * Uses contingency table with threshold = PRECIP_THRESHOLD.
 */
export function computePrecipitationMetrics(
  predicted: number[],
  observed: number[]
): PrecipitationMetricResult {
  const n = Math.min(predicted.length, observed.length)
  if (n === 0) {
    return { mae: null, rmse: null, bias: null, pod: null, far: null, csi: null, sampleCount: 0 }
  }

  // Continuous metrics
  let sumAbsErr = 0
  let sumSqErr = 0
  let sumErr = 0
  let hits = 0
  let misses = 0
  let falseAlarms = 0

  for (let i = 0; i < n; i++) {
    const err = predicted[i] - observed[i]
    sumAbsErr += Math.abs(err)
    sumSqErr += err * err
    sumErr += err

    const predRain = predicted[i] >= PRECIP_THRESHOLD
    const obsRain = observed[i] >= PRECIP_THRESHOLD

    if (predRain && obsRain) hits++
    else if (!predRain && obsRain) misses++
    else if (predRain && !obsRain) falseAlarms++
    else { /* negativo correcto: no entra en POD/FAR/CSI */ }
  }

  const mae = sumAbsErr / n
  const rmse = Math.sqrt(sumSqErr / n)
  const bias = sumErr / n

  // Contingency table metrics
  const pod = (hits + misses) > 0 ? hits / (hits + misses) : null
  const far = (hits + falseAlarms) > 0 ? falseAlarms / (hits + falseAlarms) : null
  const csi = (hits + misses + falseAlarms) > 0
    ? hits / (hits + misses + falseAlarms)
    : null

  return {
    mae,
    rmse,
    bias,
    pod,
    far,
    csi,
    sampleCount: n,
  }
}

/**
 * Compute verification metrics for any metric type.
 */
export function computeMetrics(
  predicted: number[],
  observed: number[],
  metric: string
): MetricResult | PrecipitationMetricResult {
  if (metric === 'precipitation') {
    return computePrecipitationMetrics(predicted, observed)
  }
  return computeContinuousMetrics(predicted, observed)
}
