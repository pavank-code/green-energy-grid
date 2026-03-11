/**
 * GreenGrid Intelligence — Multi-Energy Generation Models
 * 
 * Scientific formulas for:
 *   Solar Farms, Wind Turbines, Small Hydro, Biogas Plants, Biomass Power, Hybrid
 */

// ── ENERGY TYPE DEFINITIONS ──────────────────────────────────

export interface EnergyTypeConfig {
  id: string;
  name: string;
  icon: string;
  minBudget: number;          // Minimum viable budget (INR)
  landPerMW: number;          // Acres per MW
  capexPerKW: number;         // INR per kW installed
  opexFraction: number;       // Annual OPEX as fraction of CAPEX
  tariff: number;             // INR/kWh (CERC/state benchmark)
  projectLife: number;        // Years
  minCapacity: number;        // Minimum viable kW
  feasibility: string;        // Human-readable feasibility conditions
}

export const ENERGY_CONFIGS: Record<string, EnergyTypeConfig> = {
  solar: {
    id: 'solar',
    name: 'Solar Farm',
    icon: '☀️',
    minBudget: 300000,         // ₹3L for small rooftop
    landPerMW: 4.5,            // 4.5 acres/MWp
    capexPerKW: 50,            // ₹50/Wp = ₹50,000/kWp
    opexFraction: 0.012,       // 1.2% annually
    tariff: 2.80,              // INR/kWh CERC FY2024-25
    projectLife: 25,
    minCapacity: 1,            // 1 kW minimum
    feasibility: 'GHI > 4.0 kWh/m²/day, flat terrain, low cloud cover',
  },
  wind: {
    id: 'wind',
    name: 'Wind Turbine',
    icon: '🌬️',
    minBudget: 5000000,        // ₹50L minimum (small turbine)
    landPerMW: 45,             // 45 acres/MW (spacing)
    capexPerKW: 65000,         // ₹6.5Cr/MW
    opexFraction: 0.020,       // 2.0% annually
    tariff: 3.20,              // INR/kWh
    projectLife: 25,
    minCapacity: 100,          // 100 kW minimum small turbine
    feasibility: 'Wind speed > 5 m/s at hub height, open terrain, no obstructions',
  },
  hybrid: {
    id: 'hybrid',
    name: 'Solar-Wind Hybrid',
    icon: '⚡',
    minBudget: 5000000,
    landPerMW: 20,             // Shared land
    capexPerKW: 55000,         // Blended
    opexFraction: 0.015,
    tariff: 3.00,
    projectLife: 25,
    minCapacity: 50,
    feasibility: 'Both GHI > 4.5 and Wind > 4.5 m/s, large open area',
  },
  small_hydro: {
    id: 'small_hydro',
    name: 'Small Hydro',
    icon: '💧',
    minBudget: 10000000,       // ₹1Cr minimum
    landPerMW: 2,              // Much less land needed
    capexPerKW: 80000,         // ₹8Cr/MW
    opexFraction: 0.025,       // 2.5% annually
    tariff: 4.18,              // INR/kWh (CERC SHP benchmark)
    projectLife: 35,
    minCapacity: 100,
    feasibility: 'Perennial river/stream, head > 5m, rainfall > 1000mm/year, hilly terrain',
  },
  biogas: {
    id: 'biogas',
    name: 'Biogas Plant',
    icon: '♻️',
    minBudget: 500000,         // ₹5L for small plant
    landPerMW: 1,              // Very compact
    capexPerKW: 45000,         // ₹4.5Cr/MW
    opexFraction: 0.035,       // 3.5% (feedstock management)
    tariff: 5.50,              // INR/kWh (higher — firm power)
    projectLife: 20,
    minCapacity: 5,            // 5 kW micro biogas
    feasibility: 'Agricultural region, cattle/poultry farms nearby, organic waste supply',
  },
  biomass: {
    id: 'biomass',
    name: 'Biomass Power',
    icon: '🌾',
    minBudget: 20000000,       // ₹2Cr minimum
    landPerMW: 3,              // Plant + fuel storage
    capexPerKW: 55000,         // ₹5.5Cr/MW
    opexFraction: 0.040,       // 4.0% (fuel costs)
    tariff: 4.88,              // INR/kWh (CERC biomass)
    projectLife: 20,
    minCapacity: 500,
    feasibility: 'Agricultural region, rice/wheat/sugarcane, biomass supply > 20km radius',
  },
};

// ── SOLAR GENERATION MODEL ───────────────────────────────────
/**
 * Solar energy: E = GHI × A × η × PR × 365 × Td
 *   GHI  = Global Horizontal Irradiance (kWh/m²/day)
 *   A    = Panel area (m²) — 5.0 m² per kWp (monocrystalline)
 *   η    = Panel efficiency — 20% (standard mono-Si)
 *   PR   = Performance Ratio — 0.78 (includes soiling, wiring, mismatch)
 *   Td   = Temperature derating — -0.4%/°C above 25°C cell temp
 */
export function solarGeneration(capacityKW: number, ghi: number, tempMax: number): number {
  const panelArea = capacityKW * 5.0;
  const efficiency = 0.20;
  const performanceRatio = 0.78;
  const tempDerating = Math.max(0.85, 1 - Math.max(0, (tempMax - 35) * 0.004));
  return (ghi * panelArea * efficiency * performanceRatio * 365 * tempDerating) / 1000; // MWh
}

// ── WIND GENERATION MODEL ────────────────────────────────────
/**
 * Wind energy: E = P_rated × CF × 8760 × WakeLoss
 *   P_rated = Installed capacity (MW)
 *   CF = Capacity Factor (from wind speed lookup curve)
 *   8760 = Hours per year
 *   WakeLoss = 0.92 (8% wake loss for multi-turbine arrays)
 * 
 * Wind power physics: P = 0.5 × ρ × A × V³ × Cp
 *   ρ = air density (1.225 kg/m³ at sea level)
 *   A = rotor swept area (π × r²)
 *   V = wind speed (m/s)
 *   Cp = power coefficient (max 0.593, Betz limit; typical 0.35-0.45)
 */
export function windGeneration(capacityMW: number, windSpeed50m: number): number {
  const cf = windCapacityFactor(windSpeed50m);
  return capacityMW * cf * 8760 * 0.92; // MWh
}

export function windCapacityFactor(windSpeed50m: number): number {
  // IEC Class 3 turbine capacity factor curve
  if (windSpeed50m < 3.0) return 0.05;
  if (windSpeed50m < 4.0) return 0.10;
  if (windSpeed50m < 5.0) return 0.16;
  if (windSpeed50m < 6.0) return 0.24;
  if (windSpeed50m < 7.0) return 0.32;
  if (windSpeed50m < 8.0) return 0.38;
  if (windSpeed50m < 9.0) return 0.43;
  return 0.48;
}

// ── SMALL HYDRO GENERATION MODEL ─────────────────────────────
/**
 * Hydro energy: E = P × CF × 8760
 *   P = ρ × g × Q × H × η_turbine
 *   ρ = water density (1000 kg/m³)
 *   g = gravitational acceleration (9.81 m/s²)
 *   Q = flow rate (m³/s) — estimated from precipitation
 *   H = head (m) — estimated from elevation
 *   η = turbine efficiency (0.80-0.90)
 *   CF = Capacity Factor (0.40-0.60 for small hydro in India)
 */
export function smallHydroGeneration(capacityMW: number, precipitation: number, elevation: number): number {
  // CF depends on rainfall consistency
  let cf = 0.45; // Base CF
  if (precipitation > 2000) cf = 0.55;
  else if (precipitation > 1500) cf = 0.50;
  else if (precipitation < 800) cf = 0.30;
  return capacityMW * cf * 8760; // MWh
}

export function estimateHydroHead(elevation: number): number {
  // Rough head estimate from elevation (hilly terrain implies available head)
  if (elevation > 1000) return 50;
  if (elevation > 600) return 25;
  if (elevation > 300) return 10;
  return 5;
}

// ── BIOGAS GENERATION MODEL ──────────────────────────────────
/**
 * Biogas: E = V_gas × CV × η_engine × 365
 *   V_gas = Daily biogas production (m³/day)
 *   CV = Calorific value of biogas (5.5 kWh/m³)
 *   η_engine = Engine efficiency (0.35-0.40)
 *   
 * For cattle dung: ~40 kg dung → 1 m³ biogas → 2 kWh electricity
 * Plant size determines feedstock requirement
 */
export function biogasGeneration(capacityKW: number): number {
  // A 1 kW biogas plant runs at ~80% load factor
  const cf = 0.80;
  return (capacityKW * cf * 8760) / 1000; // MWh
}

// ── BIOMASS GENERATION MODEL ─────────────────────────────────
/**
 * Biomass: E = P × CF × 8760
 *   CF typically 0.70-0.85 (base load plant)
 *   Fuel consumption: ~1.5 kg biomass per kWh
 *   Common fuels: rice husk, wheat straw, bagasse, wood chips
 */
export function biomassGeneration(capacityMW: number): number {
  const cf = 0.75; // Typical Indian biomass plant CF
  return capacityMW * cf * 8760; // MWh
}

// ── HYBRID GENERATION MODEL ──────────────────────────────────
export function hybridGeneration(
  totalCapacityMW: number, solarFraction: number,
  ghi: number, tempMax: number, windSpeed50m: number
): { solarMWh: number; windMWh: number; totalMWh: number } {
  const solarCapacityKW = totalCapacityMW * solarFraction * 1000;
  const windCapacityMW = totalCapacityMW * (1 - solarFraction);
  const solarMWh = solarGeneration(solarCapacityKW, ghi, tempMax);
  const windMWh = windGeneration(windCapacityMW, windSpeed50m);
  return { solarMWh, windMWh, totalMWh: solarMWh + windMWh };
}

// ── FEASIBILITY CHECKER ──────────────────────────────────────
export interface FeasibilityResult {
  viable: boolean;
  score: number;        // 0-100
  reasons: string[];
  warnings: string[];
}

export function checkFeasibility(
  energyType: string,
  ghi: number,
  windSpeed: number,
  precipitation: number,
  elevation: number,
  tempMax: number
): FeasibilityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 50; // Base

  switch (energyType) {
    case 'solar':
      if (ghi >= 5.0) { score += 30; reasons.push(`Excellent GHI: ${ghi.toFixed(1)} kWh/m²/day`); }
      else if (ghi >= 4.0) { score += 15; reasons.push(`Good GHI: ${ghi.toFixed(1)} kWh/m²/day`); }
      else { score -= 20; warnings.push(`Low GHI: ${ghi.toFixed(1)} kWh/m²/day (< 4.0 threshold)`); }
      if (tempMax > 42) { score -= 10; warnings.push(`Very high temps (${tempMax}°C) will degrade panel output`); }
      if (elevation > 1000) { score -= 5; warnings.push('High elevation may indicate steep terrain'); }
      break;

    case 'wind':
      if (windSpeed >= 7.0) { score += 35; reasons.push(`Excellent wind: ${windSpeed.toFixed(1)} m/s`); }
      else if (windSpeed >= 5.0) { score += 15; reasons.push(`Good wind: ${windSpeed.toFixed(1)} m/s`); }
      else { score -= 25; warnings.push(`Low wind: ${windSpeed.toFixed(1)} m/s (< 5.0 m/s not viable)`); }
      break;

    case 'hybrid':
      if (ghi >= 4.5 && windSpeed >= 4.5) { score += 30; reasons.push('Both solar and wind resources adequate'); }
      else if (ghi >= 4.5 || windSpeed >= 4.5) { score += 10; reasons.push('One resource strong, complementary potential'); }
      else { score -= 15; warnings.push('Neither solar nor wind resource is strong here'); }
      break;

    case 'small_hydro':
      if (precipitation > 1500 && elevation > 300) { score += 35; reasons.push(`Good hydro potential: ${precipitation.toFixed(0)}mm rain, ${elevation}m elevation`); }
      else if (precipitation > 1000) { score += 15; reasons.push(`Moderate rainfall: ${precipitation.toFixed(0)}mm/year`); }
      else { score -= 30; warnings.push(`Low rainfall: ${precipitation.toFixed(0)}mm — hydro not viable`); }
      if (elevation < 200) { score -= 15; warnings.push('Flat terrain — insufficient hydraulic head'); }
      break;

    case 'biogas':
      score += 20; // Biogas is viable in most agricultural regions
      reasons.push('Biogas feasibility depends on local feedstock availability');
      if (tempMax < 15) { score -= 10; warnings.push('Cold climate slows anaerobic digestion'); }
      break;

    case 'biomass':
      score += 15;
      reasons.push('Biomass viability depends on agricultural crop residue supply');
      if (precipitation < 500) { score -= 15; warnings.push('Arid region — limited agricultural residue'); }
      break;
  }

  return {
    viable: score >= 40,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    warnings,
  };
}

// ── CAPACITY ESTIMATOR (budget → capacity) ───────────────────
export function estimateCapacityFromBudget(
  budget: number, energyType: string, landRatePerAcre: number, gridDistanceKm: number
): { capacityKW: number; landAcres: number; landCost: number; equipmentCost: number; gridCost: number } {
  const config = ENERGY_CONFIGS[energyType] || ENERGY_CONFIGS.solar;
  
  const gridCost = gridDistanceKm * 3500000; // ₹35L/km
  const remainingBudget = Math.max(budget * 0.1, budget - gridCost);
  
  // Land should not exceed 30% of remaining budget
  const maxLandBudget = remainingBudget * 0.30;
  
  // First estimate: capacity from full equipment budget
  const equipmentBudget = remainingBudget * 0.70;
  let capacityKW = Math.max(config.minCapacity, (equipmentBudget / config.capexPerKW) * 1000);
  
  // Check land requirement and cost
  let landAcres = (capacityKW / 1000) * config.landPerMW;
  let landCost = landAcres * landRatePerAcre;
  
  // If land cost exceeds budget allocation, reduce capacity
  if (landCost > maxLandBudget) {
    landCost = maxLandBudget;
    landAcres = landCost / landRatePerAcre;
    // Constrain capacity by available land
    const maxCapacityByLand = (landAcres / config.landPerMW) * 1000; // kW
    capacityKW = Math.min(capacityKW, maxCapacityByLand);
  }
  
  const actualEquipmentCost = capacityKW * config.capexPerKW;
  
  return {
    capacityKW: Math.max(config.minCapacity, capacityKW),
    landAcres: Math.max(0.1, landAcres),
    landCost: Math.max(0, landCost),
    equipmentCost: actualEquipmentCost,
    gridCost: Math.max(0, gridCost),
  };
}
