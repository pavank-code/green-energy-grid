/**
 * GreenGrid Intelligence — Multi-Source Site Scoring Engine
 *
 * Generates independent scores for:
 *   Solar, Wind, Weather Stability, Land Suitability, Grid Accessibility
 * Then computes a Composite Renewable Score.
 *
 * Every score includes: value, source, confidence, last_updated
 */

export interface ScoreMetric {
  value: number;       // 0-100
  source: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  last_updated: string;
  details: string;
}

export interface MultiSourceScores {
  solarScore: ScoreMetric;
  windScore: ScoreMetric;
  weatherStability: ScoreMetric;
  landSuitability: ScoreMetric;
  gridAccessibility: ScoreMetric;
  compositeScore: number;
  energyMix: { solar: number; wind: number };
  recommendation: string;
  inputs: {
    ghi_used: number;
    wind_speed_used: number;
    grid_distance_km: number | undefined;
    slope_degrees: number;
    precipitation: number;
    temp_avg: number;
    temp_max: number;
  };
}

const TODAY = new Date().toISOString().split('T')[0];

export function computeSiteScores(nasaData: any, elevation_m: number, gridDistance: any): MultiSourceScores {
  const ghi = nasaData.ghi;
  const wind = nasaData.windSpeed50m;
  const slope = estimateSlope(elevation_m);
  const precipitation = nasaData.precipitation || 0;
  const tempAvg = nasaData.tempAvg || 28;
  const tempMax = nasaData.tempMax || 38;
  const nasaSource = nasaData.source || 'NASA POWER Climatology (2010-2023)';
  const nasaConf = nasaData.confidence === 'HIGH' ? 'HIGH' : (nasaData.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW');
  const gridDist = gridDistance?.distance_km;

  // ── 1. SOLAR SCORE (0-100) ────────────────────────────────
  const ghiNorm = Math.max(0, Math.min(1, (ghi - 3.5) / (7.0 - 3.5)));
  const tempPenalty = Math.max(0, (tempMax - 35) * 0.004);
  const gridScoreVal = gridDist ? Math.max(0, 1 - (gridDist / 100)) : 0.5;
  const terrainScore = Math.max(0, 1 - (slope / 30));
  const solarVal = Math.round(
    (0.50 * ghiNorm + 0.20 * gridScoreVal + 0.20 * terrainScore - tempPenalty * 0.10) * 100
  );
  const solarScore: ScoreMetric = {
    value: clamp(solarVal),
    source: nasaSource,
    confidence: nasaConf as any,
    last_updated: TODAY,
    details: `GHI=${ghi.toFixed(2)} kWh/m²/day, TempMax=${tempMax}°C, Slope=${slope}°`,
  };

  // ── 2. WIND SCORE (0-100) ─────────────────────────────────
  const windNorm = Math.max(0, Math.min(1, (wind - 3.0) / (10.0 - 3.0)));
  const cf = estimateCapacityFactor(wind);
  const cfNorm = Math.max(0, Math.min(1, (cf - 0.15) / (0.50 - 0.15)));
  const windVal = Math.round(
    (0.55 * windNorm + 0.30 * cfNorm + 0.15 * gridScoreVal) * 100
  );
  const windScoreObj: ScoreMetric = {
    value: clamp(windVal),
    source: nasaSource,
    confidence: nasaConf as any,
    last_updated: TODAY,
    details: `Wind50m=${wind.toFixed(1)} m/s, CF=${(cf * 100).toFixed(0)}%`,
  };

  // ── 3. WEATHER STABILITY SCORE (0-100) ────────────────────
  // Based on: temperature consistency, precipitation patterns, low extreme risk
  let weatherVal = 60; // Base
  if (tempAvg >= 20 && tempAvg <= 35) weatherVal += 15;
  else if (tempAvg < 10 || tempAvg > 40) weatherVal -= 15;
  if (precipitation > 500 && precipitation < 2000) weatherVal += 10; // Moderate rain is ok
  if (precipitation > 3000) weatherVal -= 20; // Excessive rain (flood risk)
  if (tempMax <= 42) weatherVal += 10;
  else weatherVal -= 10; // Extreme heat degrades equipment
  const weatherStability: ScoreMetric = {
    value: clamp(weatherVal),
    source: nasaSource,
    confidence: nasaConf as any,
    last_updated: TODAY,
    details: `AvgTemp=${tempAvg.toFixed(1)}°C, Precip=${precipitation.toFixed(0)}mm/yr`,
  };

  // ── 4. LAND SUITABILITY SCORE (0-100) ─────────────────────
  // Based on: terrain flatness, elevation, distance from urban centers
  let landVal = 50;
  if (slope <= 5) landVal += 30;        // Very flat — ideal
  else if (slope <= 12) landVal += 15;   // Moderate — acceptable
  else landVal -= 20;                     // Steep — difficult
  if (elevation_m < 500) landVal += 10;  // Low elevation plains
  else if (elevation_m > 1500) landVal -= 15; // High mountains
  const landSuitability: ScoreMetric = {
    value: clamp(landVal),
    source: 'SRTM 30m Elevation + Terrain Analysis',
    confidence: elevation_m !== 300 ? 'MEDIUM' : 'LOW',
    last_updated: TODAY,
    details: `Elevation=${elevation_m}m, Slope≈${slope}°`,
  };

  // ── 5. GRID ACCESSIBILITY SCORE (0-100) ───────────────────
  let gridVal = 50;
  if (gridDist !== undefined && gridDist !== null) {
    if (gridDist <= 5) gridVal = 95;
    else if (gridDist <= 15) gridVal = 80;
    else if (gridDist <= 30) gridVal = 60;
    else if (gridDist <= 50) gridVal = 40;
    else gridVal = 20;
  }
  const gridAccessibility: ScoreMetric = {
    value: clamp(gridVal),
    source: gridDistance?.source || 'OpenStreetMap via Overpass API',
    confidence: gridDist !== undefined ? 'MEDIUM' : 'LOW',
    last_updated: TODAY,
    details: gridDist !== undefined ? `Nearest substation: ${gridDist} km` : 'Estimated (API unavailable)',
  };

  // ── COMPOSITE SCORE ───────────────────────────────────────
  const solarWeight = ghi > 5.0 ? 0.6 : 0.4;
  const windWeight = wind > 5.5 ? 0.4 : 0.6;
  const totalWeight = solarWeight + windWeight;
  const compositeScore = Math.round(
    (solarScore.value * 0.30) +
    (windScoreObj.value * 0.20) +
    (weatherStability.value * 0.15) +
    (landSuitability.value * 0.15) +
    (gridAccessibility.value * 0.20)
  );

  // ── ENERGY MIX RECOMMENDATION ─────────────────────────────
  let energyMix, recommendation;
  if (solarScore.value >= 70 && windScoreObj.value >= 60) {
    energyMix = { solar: 60, wind: 40 };
    recommendation = 'Hybrid Solar-Wind';
  } else if (solarScore.value >= windScoreObj.value * 1.3) {
    const solarPct = Math.round(60 + (solarScore.value - windScoreObj.value) * 0.4);
    energyMix = { solar: Math.min(95, solarPct), wind: Math.max(5, 100 - solarPct) };
    recommendation = solarPct > 80 ? 'Solar-Dominant' : 'Solar-Primary Hybrid';
  } else if (windScoreObj.value >= solarScore.value * 1.3) {
    const windPct = Math.round(60 + (windScoreObj.value - solarScore.value) * 0.4);
    energyMix = { solar: Math.max(5, 100 - windPct), wind: Math.min(95, windPct) };
    recommendation = windPct > 80 ? 'Wind-Dominant' : 'Wind-Primary Hybrid';
  } else {
    energyMix = { solar: 50, wind: 50 };
    recommendation = 'Balanced Hybrid';
  }

  return {
    solarScore,
    windScore: windScoreObj,
    weatherStability,
    landSuitability,
    gridAccessibility,
    compositeScore: clamp(compositeScore),
    energyMix,
    recommendation,
    inputs: {
      ghi_used: ghi,
      wind_speed_used: wind,
      grid_distance_km: gridDist,
      slope_degrees: slope,
      precipitation,
      temp_avg: tempAvg,
      temp_max: tempMax,
    },
  };
}

function clamp(val: number): number {
  return Math.max(0, Math.min(100, val));
}

export function estimateCapacityFactor(windSpeed_ms: number) {
  if (windSpeed_ms < 3.0) return 0.05;
  if (windSpeed_ms < 4.0) return 0.10;
  if (windSpeed_ms < 5.0) return 0.16;
  if (windSpeed_ms < 6.0) return 0.24;
  if (windSpeed_ms < 7.0) return 0.32;
  if (windSpeed_ms < 8.0) return 0.38;
  if (windSpeed_ms < 9.0) return 0.43;
  return 0.48;
}

function estimateSlope(elevation_m: number) {
  if (elevation_m < 100) return 2;
  if (elevation_m < 300) return 5;
  if (elevation_m < 600) return 12;
  if (elevation_m < 1200) return 20;
  return 30;
}
