import { estimateCapacityFactor } from './scoreEngine';
import { getLandRateForState } from './landRateLookup';
import { ENERGY_CONFIGS, solarGeneration, windGeneration, smallHydroGeneration, biogasGeneration, biomassGeneration, hybridGeneration } from './energyModels';

// 2024 CAPEX benchmarks (INR per unit)
const CAPEX_BENCHMARKS = {
  solar_per_kwp: 50000,
  wind_per_mw: 65000000,
  small_hydro_per_mw: 80000000,
  biogas_per_kw: 45000,
  biomass_per_mw: 55000000,
  installation_fraction: 0.15,
  grid_connection_per_km: 3500000,
};

const TARIFF_BENCHMARKS: Record<string, number> = {
  solar: 2.80,
  wind: 3.20,
  hybrid: 3.00,
  small_hydro: 4.18,
  biogas: 5.50,
  biomass: 4.88,
};

const OPEX_RATES: Record<string, number> = {
  solar: 0.012,
  wind: 0.020,
  hybrid: 0.015,
  small_hydro: 0.025,
  biogas: 0.035,
  biomass: 0.040,
};

const PROJECT_LIFE: Record<string, number> = {
  solar: 25,
  wind: 25,
  hybrid: 25,
  small_hydro: 35,
  biogas: 20,
  biomass: 20,
};

export function computeFinancials(
  budget_inr: number, energyType: string, nasaData: any, landRateData: any,
  gridDistanceKm: number, capacityMW: number,
  specificProperty?: { price_inr: number, area_acres: number },
  projectionYears?: number
) {
  gridDistanceKm = gridDistanceKm || 10;
  const life = PROJECT_LIFE[energyType] || 25;
  const chartYears = projectionYears || 10;

  let annualMWh = 0, installedCapacity = 0, numPanels = 0, numTurbines = 0;
  let overriddenCapex = budget_inr;

  // ── PROPERTY-FIRST OVERRIDE ───────────────────────────────
  if (specificProperty && specificProperty.area_acres > 0) {
    const areaAcres = Math.max(0.5, specificProperty.area_acres);
    const propPrice = Math.max(0, specificProperty.price_inr);
    const config = ENERGY_CONFIGS[energyType] || ENERGY_CONFIGS.solar;

    const equipBudget = Math.max(config.minCapacity * (config.capexPerKW || 50), budget_inr - propPrice - gridDistanceKm * CAPEX_BENCHMARKS.grid_connection_per_km);
    const kWFromBudget = equipBudget / (config.capexPerKW || 50);
    const kWFromArea = (areaAcres / config.landPerMW) * 1000;
    installedCapacity = Math.max(config.minCapacity, Math.min(kWFromBudget, kWFromArea)) / 1000; // MW

    overriddenCapex = installedCapacity * (config.capexPerKW || 50) * 1000 + propPrice + gridDistanceKm * CAPEX_BENCHMARKS.grid_connection_per_km;
  }

  // ── BUDGET-BASED CAPACITY ─────────────────────────────────
  if (!specificProperty || specificProperty.area_acres <= 0) {
    const targetCapacity = Math.max(0.001, budget_inr / 50000000);

    if (energyType === 'solar') {
      let landCost = computeLandCost(landRateData, targetCapacity, 'solar');
      landCost = Math.min(landCost, budget_inr * 0.30);
      const equipBudget = Math.max(0.1 * CAPEX_BENCHMARKS.solar_per_kwp * 1000, budget_inr - landCost);
      const capacity_kWp = Math.max(1, equipBudget / CAPEX_BENCHMARKS.solar_per_kwp);
      installedCapacity = capacity_kWp / 1000;
      numPanels = Math.floor(capacity_kWp / 0.55);
    } else if (energyType === 'wind') {
      let landCost = computeLandCost(landRateData, targetCapacity, 'wind');
      landCost = Math.min(landCost, budget_inr * 0.30);
      const equipBudget = Math.max(0.1 * CAPEX_BENCHMARKS.wind_per_mw, budget_inr - landCost);
      installedCapacity = Math.max(0.1, equipBudget / CAPEX_BENCHMARKS.wind_per_mw);
      numTurbines = Math.max(1, Math.floor(installedCapacity / 2.0));
    } else if (energyType === 'hybrid') {
      // 60% solar, 40% wind budget split
      let landCost = computeLandCost(landRateData, targetCapacity, 'solar');
      landCost = Math.min(landCost, budget_inr * 0.30);
      const solarBudget = (budget_inr - landCost) * 0.60;
      const windBudget = (budget_inr - landCost) * 0.40;
      const solarKWp = Math.max(1, solarBudget / CAPEX_BENCHMARKS.solar_per_kwp);
      const windMW = Math.max(0.1, windBudget / CAPEX_BENCHMARKS.wind_per_mw);
      installedCapacity = solarKWp / 1000 + windMW;
      numPanels = Math.floor(solarKWp / 0.55);
      numTurbines = Math.max(0, Math.floor(windMW / 2.0));
    } else if (energyType === 'small_hydro') {
      let landCost = computeLandCost(landRateData, targetCapacity, 'small_hydro');
      landCost = Math.min(landCost, budget_inr * 0.15); // Hydro needs less land
      const equipBudget = Math.max(budget_inr * 0.5, budget_inr - landCost);
      installedCapacity = Math.max(0.1, equipBudget / CAPEX_BENCHMARKS.small_hydro_per_mw);
    } else if (energyType === 'biogas') {
      const equipBudget = budget_inr * 0.85; // Less land needed
      const capacityKW = Math.max(5, equipBudget / CAPEX_BENCHMARKS.biogas_per_kw);
      installedCapacity = capacityKW / 1000;
    } else if (energyType === 'biomass') {
      let landCost = computeLandCost(landRateData, targetCapacity, 'biomass');
      landCost = Math.min(landCost, budget_inr * 0.20);
      const equipBudget = Math.max(budget_inr * 0.5, budget_inr - landCost);
      installedCapacity = Math.max(0.5, equipBudget / CAPEX_BENCHMARKS.biomass_per_mw);
    }
  }

  // ── ENERGY GENERATION ─────────────────────────────────────
  installedCapacity = Math.max(0.001, installedCapacity);

  switch (energyType) {
    case 'solar':
      annualMWh = solarGeneration(installedCapacity * 1000, nasaData.ghi, nasaData.tempMax);
      if (numPanels === 0) numPanels = Math.floor(installedCapacity * 1000 / 0.55);
      break;
    case 'wind':
      annualMWh = windGeneration(installedCapacity, nasaData.windSpeed50m);
      if (numTurbines === 0) numTurbines = Math.max(1, Math.floor(installedCapacity / 2.0));
      break;
    case 'hybrid': {
      const result = hybridGeneration(installedCapacity, 0.6, nasaData.ghi, nasaData.tempMax, nasaData.windSpeed50m);
      annualMWh = result.totalMWh;
      break;
    }
    case 'small_hydro':
      annualMWh = smallHydroGeneration(installedCapacity, nasaData.precipitation || 1000, nasaData.tempAvg || 300);
      break;
    case 'biogas':
      annualMWh = biogasGeneration(installedCapacity * 1000);
      break;
    case 'biomass':
      annualMWh = biomassGeneration(installedCapacity);
      break;
    default:
      annualMWh = solarGeneration(installedCapacity * 1000, nasaData.ghi, nasaData.tempMax);
  }

  annualMWh = Math.max(1, annualMWh);

  // ── LAND COST ─────────────────────────────────────────────
  let landCost_inr;
  if (specificProperty) {
    landCost_inr = specificProperty.price_inr;
  } else {
    landCost_inr = computeLandCost(landRateData, installedCapacity, energyType);
    if (landCost_inr > overriddenCapex * 0.30) landCost_inr = overriddenCapex * 0.30;
  }
  const landCost_cr = landCost_inr / 1e7;

  // ── GRID CONNECTION COST ──────────────────────────────────
  const gridCost_inr = (gridDistanceKm || 10) * CAPEX_BENCHMARKS.grid_connection_per_km;
  const gridCost_cr = gridCost_inr / 1e7;

  // ── TOTAL CAPEX ───────────────────────────────────────────
  const totalCapex_cr = overriddenCapex / 1e7;
  const equipCost_cr = Math.max(0, totalCapex_cr - landCost_cr - gridCost_cr);

  // ── REVENUE ───────────────────────────────────────────────
  const tariff = TARIFF_BENCHMARKS[energyType] || TARIFF_BENCHMARKS.solar;
  const annualRevenue_base = (annualMWh * 1000 * tariff) / 1e7;
  const annualRevenue_low = annualRevenue_base * 0.90;
  const annualRevenue_high = annualRevenue_base * 1.12;

  // ── OPEX ──────────────────────────────────────────────────
  const opexRate = OPEX_RATES[energyType] || OPEX_RATES.solar;
  const annualOpex_cr = totalCapex_cr * opexRate;
  const annualNetCashflow_cr = annualRevenue_base - annualOpex_cr;

  // ── PAYBACK ───────────────────────────────────────────────
  const simplePayback_years = annualNetCashflow_cr > 0
    ? parseFloat((totalCapex_cr / annualNetCashflow_cr).toFixed(1))
    : 99;

  // ── IRR ────────────────────────────────────────────────────
  const irr = computeIRR(totalCapex_cr, annualNetCashflow_cr, life);

  // ── NPV ────────────────────────────────────────────────────
  const wacc = 0.11;
  let npv = -totalCapex_cr;
  for (let t = 1; t <= life; t++) {
    npv += annualNetCashflow_cr / Math.pow(1 + wacc, t);
  }

  // ── LCOE ───────────────────────────────────────────────────
  const crf = (wacc * Math.pow(1 + wacc, life)) / (Math.pow(1 + wacc, life) - 1);
  const totalAnnualCost_cr = totalCapex_cr * crf + annualOpex_cr;
  const lcoe_inr_per_kwh = annualMWh > 0 ? (totalAnnualCost_cr * 1e7) / (annualMWh * 1000) : 0;

  // ── IMPACT ─────────────────────────────────────────────────
  const co2_avoided_tonnes = annualMWh * 0.716;
  const homes_powered = Math.round(annualMWh / 1.2);
  const jobMultiplier = energyType === 'wind' ? 3.2 : energyType === 'biogas' ? 8 : energyType === 'biomass' ? 10 : 5.5;
  const jobs_created = Math.max(1, Math.round(installedCapacity * jobMultiplier));

  // ── LAND & EQUIPMENT ───────────────────────────────────────
  const config = ENERGY_CONFIGS[energyType] || ENERGY_CONFIGS.solar;
  const landAcres = specificProperty?.area_acres || Math.max(0.1, installedCapacity * config.landPerMW);
  const inverterkW = (energyType === 'solar' || energyType === 'hybrid') ? Math.max(1, Math.ceil(installedCapacity * 1000 / 500)) : 0;
  const transformerMVA = Math.max(1, Math.ceil(installedCapacity * 1.1));

  // ── REVENUE PROJECTION ─────────────────────────────────────
  const tariffEscalation = 0.03;
  const degradation = (energyType === 'solar' || energyType === 'hybrid') ? 0.005 : 0;
  const revenueProjection = Array.from({ length: chartYears }, (_, i) => ({
    year: new Date().getFullYear() + i,
    revenue_cr: parseFloat((annualRevenue_base * Math.pow(1 + tariffEscalation, i) * Math.pow(1 - degradation, i)).toFixed(3)),
    cumulative_cr: parseFloat(
      Array.from({ length: i + 1 }, (_, j) =>
        annualRevenue_base * Math.pow(1 + tariffEscalation, j) * Math.pow(1 - degradation, j)
      ).reduce((a, b) => a + b, 0).toFixed(3)
    ),
    net_profit_cr: parseFloat(
      (annualRevenue_base * Math.pow(1 + tariffEscalation, i) * Math.pow(1 - degradation, i) - annualOpex_cr * Math.pow(1.02, i)).toFixed(3)
    ),
  }));

  return {
    installed_capacity_mwp: Math.max(0.001, parseFloat(installedCapacity.toFixed(3))),
    num_panels: Math.max(0, numPanels),
    num_turbines: Math.max(0, numTurbines),
    inverters_500kw: inverterkW,
    transformer_mva: Math.max(1, transformerMVA),
    land_required_acres: Math.max(0.1, parseFloat(landAcres.toFixed(1))),

    annual_generation_mwh: Math.max(1, Math.round(annualMWh)),
    annual_generation_gwh: Math.max(0.001, parseFloat((annualMWh / 1000).toFixed(3))),

    total_capex_crore: Math.max(0.001, parseFloat(totalCapex_cr.toFixed(3))),
    land_cost_crore: Math.max(0, parseFloat(landCost_cr.toFixed(3))),
    grid_connection_crore: Math.max(0, parseFloat(gridCost_cr.toFixed(3))),
    equipment_cost_crore: Math.max(0, parseFloat(equipCost_cr.toFixed(3))),
    annual_opex_crore: Math.max(0, parseFloat(annualOpex_cr.toFixed(3))),

    annual_revenue_base_crore: Math.max(0.001, parseFloat(annualRevenue_base.toFixed(3))),
    annual_revenue_low_crore: Math.max(0.001, parseFloat(annualRevenue_low.toFixed(3))),
    annual_revenue_high_crore: Math.max(0.001, parseFloat(annualRevenue_high.toFixed(3))),
    tariff_used_inr_kwh: tariff,

    irr_percent: isNaN(irr) ? 0 : irr,
    npv_crore: parseFloat(npv.toFixed(2)) || 0,
    simple_payback_years: simplePayback_years,
    lcoe_inr_per_kwh: parseFloat(lcoe_inr_per_kwh.toFixed(2)) || 0,

    co2_avoided_tonnes_year: Math.round(co2_avoided_tonnes) || 0,
    homes_powered: homes_powered || 0,
    jobs_created: jobs_created || 0,
    coal_replaced_tonnes: Math.round(annualMWh * 0.4) || 0,

    revenue_projection: revenueProjection,

    assumptions: {
      tariff_source: `CERC benchmark FY2024-25 (₹${tariff}/kWh)`,
      capex_source: 'MNRE benchmark 2024',
      emission_factor: '0.716 kg CO₂/kWh (CEA 2023)',
      performance_ratio: energyType === 'solar' ? '0.78' : 'N/A',
      wacc: '11%',
      project_life: `${life} years`,
      degradation: degradation > 0 ? `${degradation * 100}%/year` : 'N/A',
      tariff_escalation: '3%/year',
    },
  };
}

function computeLandCost(landRateData: any, capacity_mw: number, energyType: string) {
  let rate_per_sqm = 0;

  if (landRateData && landRateData.market_rate && landRateData.market_rate.mid_per_sqft) {
    rate_per_sqm = landRateData.market_rate.mid_per_sqft / 0.092903;
  } else if (landRateData && landRateData.pricePerSqM) {
    rate_per_sqm = landRateData.pricePerSqM;
  } 
  // Else calculate via our internal fallback
  else {
    const stateName = landRateData?.address?.state || landRateData?.state || "Default";
    const lookup = getLandRateForState(stateName);
    rate_per_sqm = lookup.pricePerSqM;
  }

  rate_per_sqm = Math.min(Math.max(10, rate_per_sqm), 2000);

  const config = ENERGY_CONFIGS[energyType];
  const acresPerMW = config ? config.landPerMW : 4.5;
  const acres = capacity_mw * acresPerMW;
  return acres * 4046.86 * rate_per_sqm;
}

function computeIRR(capex: number, annualCashflow: number, years: number) {
  if (capex <= 0 || annualCashflow <= 0) return 0;
  // Newton-Raphson IRR solver
  let r = 0.12; // Initial guess
  for (let i = 0; i < 100; i++) {
    let npv = -capex;
    let dnpv = 0;
    for (let t = 1; t <= years; t++) {
      npv += annualCashflow / Math.pow(1 + r, t);
      dnpv -= t * annualCashflow / Math.pow(1 + r, t + 1);
    }
    if (Math.abs(dnpv) < 1e-10) break;
    const rNew = r - npv / dnpv;
    if (Math.abs(rNew - r) < 0.0001) break;
    r = rNew;
  }
  return parseFloat((r * 100).toFixed(1));
}
