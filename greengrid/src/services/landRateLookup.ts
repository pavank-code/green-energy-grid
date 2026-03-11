export interface LandRateData {
  state: string;
  minPriceLakhPerAcre: number;
  maxPriceLakhPerAcre: number;
  avgPriceSqM: number;
}

// 2024 agricultural land rate benchmarks for rural India
// Prices in INR per acre
const STATE_AURAL_RATES: Record<string, LandRateData> = {
  // Solar Corridors
  "Rajasthan": { state: "Rajasthan", minPriceLakhPerAcre: 5, maxPriceLakhPerAcre: 20, avgPriceSqM: 30 }, // Desert / Barren is cheaper
  "Gujarat": { state: "Gujarat", minPriceLakhPerAcre: 10, maxPriceLakhPerAcre: 30, avgPriceSqM: 49 }, // Rann of Kutch
  "Tamil Nadu": { state: "Tamil Nadu", minPriceLakhPerAcre: 10, maxPriceLakhPerAcre: 40, avgPriceSqM: 61 },
  "Karnataka": { state: "Karnataka", minPriceLakhPerAcre: 8, maxPriceLakhPerAcre: 25, avgPriceSqM: 40 },
  "Andhra Pradesh": { state: "Andhra Pradesh", minPriceLakhPerAcre: 8, maxPriceLakhPerAcre: 30, avgPriceSqM: 46 },
  "Telangana": { state: "Telangana", minPriceLakhPerAcre: 10, maxPriceLakhPerAcre: 35, avgPriceSqM: 55 },
  "Madhya Pradesh": { state: "Madhya Pradesh", minPriceLakhPerAcre: 6, maxPriceLakhPerAcre: 20, avgPriceSqM: 32 },
  "Maharashtra": { state: "Maharashtra", minPriceLakhPerAcre: 12, maxPriceLakhPerAcre: 45, avgPriceSqM: 70 },
  
  // Default fallback for other states
  "Default": { state: "India Average", minPriceLakhPerAcre: 8, maxPriceLakhPerAcre: 25, avgPriceSqM: 40 }
};

/**
 * Gets the benchmark agricultural land rate for a given state
 * Returns price in INR per square meter
 */
export function getLandRateForState(stateName: string): { pricePerSqM: number; source: string; confidence: string } {
  if (!stateName) {
    return {
      pricePerSqM: STATE_AURAL_RATES["Default"].avgPriceSqM,
      source: "National Agricultural Benchmark (Fallback)",
      confidence: "LOW"
    };
  }

  // Normalize state name for loose matching
  const normalizedInput = stateName.toLowerCase().replace(/[^a-z]/g, '');
  
  for (const [key, data] of Object.entries(STATE_AURAL_RATES)) {
    if (key === "Default") continue;
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (normalizedInput.includes(normalizedKey) || normalizedKey.includes(normalizedInput)) {
      return {
        pricePerSqM: data.avgPriceSqM,
        source: `${key} State Agricultural Benchmark`,
        confidence: "MEDIUM"
      };
    }
  }

  return {
    pricePerSqM: STATE_AURAL_RATES["Default"].avgPriceSqM,
    source: "National Agricultural Benchmark",
    confidence: "LOW"
  };
}

/**
 * Parses raw state name from reverse geocoding to find the best match
 */
export async function getLandRateByCoordinates(lat: number, lon: number): Promise<{ pricePerSqM: number; source: string; confidence: string }> {
  try {
    // Free reverse geocoding via OpenStreetMap Nominatim
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=5&addressdetails=1`, {
      headers: {
        'User-Agent': 'GreenGrid-RE-App'
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      const state = data?.address?.state || '';
      return getLandRateForState(state);
    }
  } catch (error) {
    console.warn("Reverse geocoding failed for land rate calculation", error);
  }
  
  return getLandRateForState("Default");
}
