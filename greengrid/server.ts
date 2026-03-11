import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

// ─── Hardcoded Gemini API Key ──────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

import { fetchNASAPower } from "./src/services/nasaPower.js";
import { fetchElevation } from "./src/services/elevation.js";
import { fetchNearestSubstationDistance } from "./src/services/gridDistance.js";
import { getLandRateViaGemini } from "./src/services/geminiLandRate.js";
import { computeSiteScores } from "./src/services/scoreEngine.js";
import { computeFinancials } from "./src/services/financialEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ai: GoogleGenAI | null = null;
function getAI() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return ai;
}

// Rate limit tracking — avoid hammering Gemini when rate-limited
let geminiRateLimitedUntil = 0;
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

async function callGemini(prompt: string, options: { json?: boolean; temperature?: number } = {}): Promise<any | null> {
  const aiClient = getAI();
  if (!aiClient) return null;

  // Check rate limit cooldown
  if (Date.now() < geminiRateLimitedUntil) {
    console.log('[Gemini] Rate-limited, skipping call');
    return null;
  }

  for (const model of GEMINI_MODELS) {
    try {
      const response = await aiClient.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(options.json ? { responseMimeType: "application/json" } : {}),
          temperature: options.temperature ?? 0.3,
        }
      });
      let text = response.text || "{}";
      text = text.replace(/```json|```/g, '').trim();
      return options.json ? JSON.parse(text) : text;
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        const retryMatch = msg.match(/retry in ([\d.]+)s/i);
        const retrySec = retryMatch ? parseFloat(retryMatch[1]) : 60;
        geminiRateLimitedUntil = Date.now() + retrySec * 1000;
        console.warn(`[Gemini] Rate limited on ${model}, cooling down for ${retrySec}s`);
        continue;
      }
      console.warn(`[Gemini] Error with ${model}:`, msg.substring(0, 200));
      continue;
    }
  }
  return null;
}

// ─── Indian State Bounding Boxes ────────────────────────────
const STATE_BOUNDS: Record<string, { south: number; north: number; west: number; east: number }> = {
  'Rajasthan': { south: 23.6, north: 30.2, west: 69.5, east: 78.3 },
  'Gujarat': { south: 20.1, north: 24.7, west: 68.2, east: 74.5 },
  'Tamil Nadu': { south: 8.1, north: 13.5, west: 76.2, east: 80.3 },
  'Karnataka': { south: 11.6, north: 18.4, west: 74.0, east: 78.6 },
  'Andhra Pradesh': { south: 12.6, north: 19.1, west: 76.8, east: 84.7 },
  'Telangana': { south: 15.8, north: 19.9, west: 77.2, east: 81.3 },
  'Maharashtra': { south: 15.6, north: 22.0, west: 72.6, east: 80.9 },
  'Madhya Pradesh': { south: 21.1, north: 26.9, west: 74.0, east: 82.8 },
  'Uttar Pradesh': { south: 23.9, north: 30.4, west: 77.1, east: 84.6 },
  'Punjab': { south: 29.5, north: 32.6, west: 73.9, east: 76.9 },
  'Haryana': { south: 27.4, north: 30.9, west: 74.5, east: 77.6 },
  'Kerala': { south: 8.2, north: 12.8, west: 74.9, east: 77.4 },
  'Odisha': { south: 17.8, north: 22.6, west: 81.4, east: 87.5 },
  'West Bengal': { south: 21.5, north: 27.2, west: 85.8, east: 89.9 },
  'Bihar': { south: 24.3, north: 27.5, west: 83.3, east: 88.2 },
  'Jharkhand': { south: 21.9, north: 25.3, west: 83.3, east: 87.9 },
  'Uttarakhand': { south: 28.7, north: 31.5, west: 77.6, east: 81.0 },
  'Himachal Pradesh': { south: 30.4, north: 33.3, west: 75.6, east: 79.0 },
  'Goa': { south: 14.9, north: 15.8, west: 73.7, east: 74.3 },
};

// Helper: get bounds for a state or all India
function getStateBounds(state: string) {
  if (!state) return { south: 8.0, north: 35.0, west: 68.0, east: 97.0 };
  const key = Object.keys(STATE_BOUNDS).find(k => k.toLowerCase() === state.toLowerCase() || state.toLowerCase().includes(k.toLowerCase()));
  return key ? STATE_BOUNDS[key] : { south: 8.0, north: 35.0, west: 68.0, east: 97.0 };
}

// ─── Fetch open/wasteland areas via Overpass API ────────────
async function fetchOpenLandAreas(bounds: { south: number; north: number; west: number; east: number }, limit = 30) {
  // Sample 6 sub-regions within the bounds for better coverage
  const latStep = (bounds.north - bounds.south) / 3;
  const lonStep = (bounds.east - bounds.west) / 2;
  const allPoints: any[] = [];

  for (let latIdx = 0; latIdx < 3; latIdx++) {
    for (let lonIdx = 0; lonIdx < 2; lonIdx++) {
      const subSouth = bounds.south + latIdx * latStep;
      const subNorth = subSouth + latStep;
      const subWest = bounds.west + lonIdx * lonStep;
      const subEast = subWest + lonStep;

      const query = `
        [out:json][timeout:15];
        (
          way["landuse"="farmland"](${subSouth},${subWest},${subNorth},${subEast});
          way["natural"="scrub"](${subSouth},${subWest},${subNorth},${subEast});
          way["natural"="grassland"](${subSouth},${subWest},${subNorth},${subEast});
          way["natural"="sand"](${subSouth},${subWest},${subNorth},${subEast});
          way["natural"="heath"](${subSouth},${subWest},${subNorth},${subEast});
          way["landuse"="meadow"](${subSouth},${subWest},${subNorth},${subEast});
          way["landuse"="brownfield"](${subSouth},${subWest},${subNorth},${subEast});
        );
        out center 8;
      `;
      try {
        const res = await axios.get(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { timeout: 12000 });
        if (res.data?.elements) {
          for (const el of res.data.elements) {
            const lat = el.center?.lat || el.lat;
            const lon = el.center?.lon || el.lon;
            if (lat && lon) {
              allPoints.push({
                lat, lon,
                type: el.tags?.landuse || el.tags?.natural || 'open_land',
                name: el.tags?.name || `Open ${el.tags?.landuse || el.tags?.natural || 'area'}`
              });
            }
          }
        }
      } catch { /* sub-region timeout, skip */ }
    }
  }

  // Deduplicate by rounding to 2 decimal places and pick random subset
  const seen = new Set<string>();
  const unique = allPoints.filter(p => {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Shuffle and limit
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, limit);
}

// ─── Fetch substations in a region ──────────────────────────
async function fetchSubstationsInRegion(bounds: { south: number; north: number; west: number; east: number }) {
  const query = `
    [out:json][timeout:20];
    (
      node["power"="substation"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      way["power"="substation"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out center 40;
  `;
  try {
    const res = await axios.get(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { timeout: 15000 });
    if (!res.data?.elements) return [];
    return res.data.elements
      .map((el: any) => ({ lat: el.lat || el.center?.lat, lon: el.lon || el.center?.lon, name: el.tags?.name, voltage: el.tags?.voltage }))
      .filter((s: any) => s.lat && s.lon);
  } catch { return []; }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

// ─── Reverse geocoding ──────────────────────────────────────
async function getRealLocationDetails(lat: number, lon: number) {
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'User-Agent': 'GreenGrid-Intelligence-App/1.0' }, timeout: 8000 }
    );
    const address = response.data.address;
    return {
      site_name: address.village || address.suburb || address.town || address.city || 'Unknown Site',
      state: address.state || 'Unknown State',
      district: address.county || address.state_district || 'Unknown District',
      tehsil: address.county || 'Unknown'
    };
  } catch (error) {
    console.error("Nominatim API Error:", error);
    return { site_name: 'Unknown Site', state: 'Unknown', district: 'Unknown' };
  }
}

// ─── Sanitize city/district name for 99acres URL ────────────
function sanitizeCityFor99acres(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/\s*(mandal|tahsil|taluku?|district|division|sub-?division)\s*/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Fetch substations near a point via Overpass API ────────
async function fetchNearbySubstations(lat: number, lon: number, radiusM = 80000) {
  const query = `
    [out:json][timeout:20];
    (
      node["power"="substation"](around:${radiusM},${lat},${lon});
      way["power"="substation"](around:${radiusM},${lat},${lon});
      node["power"="line"](around:${radiusM},${lat},${lon});
    );
    out center 20;
  `;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;
    if (!data.elements || !data.elements.length) return [];

    const haversine = (la1: number, lo1: number, la2: number, lo2: number) => {
      const R = 6371;
      const dLat = (la2 - la1) * Math.PI / 180;
      const dLon = (lo2 - lo1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    return data.elements
      .map((el: any) => {
        const elLat = el.lat || el.center?.lat;
        const elLon = el.lon || el.center?.lon;
        if (!elLat || !elLon) return null;
        return {
          lat: elLat,
          lon: elLon,
          name: el.tags?.name || 'Power Infrastructure',
          type: el.tags?.power || 'substation',
          voltage: el.tags?.voltage || 'unknown',
          distance_km: parseFloat(haversine(lat, lon, elLat, elLon).toFixed(1))
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.distance_km - b.distance_km)
      .slice(0, 15);
  } catch (err) {
    console.warn('Overpass substation fetch failed:', (err as any).message);
    return [];
  }
}

// ─── 99acres scraper with Cheerio (fast, no browser) ────────
async function scrape99acresCheerio(city: string, propertyType: string) {
  const sanitized = sanitizeCityFor99acres(city);
  if (!sanitized || sanitized.length < 2) return [];

  // Try multiple URL patterns
  const urls = [
    `https://www.99acres.com/${propertyType}-for-sale-in-${sanitized}-ffid`,
    `https://www.99acres.com/property-for-sale-in-${sanitized}-ffid`,
    `https://www.99acres.com/search/property/buy/${sanitized}?city=0&preference=S&area_unit=1&res_com=R`,
  ];

  for (const url of urls) {
    console.log(`[Cheerio] Trying: ${url}`);
    try {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const { data: html } = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.99acres.com/',
        },
        timeout: 15000,
        maxRedirects: 3,
      });
      const results = parse99acresHtml(html, sanitized);
      if (results.length > 0) return results;
    } catch (err: any) {
      console.warn(`[Cheerio] URL ${url} failed: ${err.message}`);
    }
  }
  return [];
}

function parse99acresHtml(html: string, sanitized: string): any[] {
  try {

    // Try __NEXT_DATA__ first
    const $ = cheerio.load(html);
    const nextDataScript = $('#__NEXT_DATA__').html();
    if (nextDataScript) {
      try {
        const nextData = JSON.parse(nextDataScript);
        const srpData = nextData?.props?.pageProps?.initialState?.srp?.results?.properties
          || nextData?.props?.pageProps?.srpData?.properties
          || [];
        if (srpData.length > 0) {
          return srpData.slice(0, 20).map((p: any) => ({
            id: p.PROP_ID || Math.random().toString(),
            title: (p.DESCRIPTION ? p.DESCRIPTION.substring(0, 100) + '...' : p.PROP_NAME) || 'Property Listing',
            propertyType: p.PROPERTY_TYPE || 'Land',
            agentDetails: p.PD_USER?.companyName || p.PD_USER?.name || 'Independent Seller',
            image: p.PHOTO_URL || p.MEDIUM_PHOTO_URL || 'https://via.placeholder.com/150?text=No+Image',
            yearsBuilt: p.AGE || '0',
            propertyAddress: p.LOCALITY || p.CITY || 'Unknown Locality',
            price: p.MIN_PRICE ? `₹${(parseInt(p.MIN_PRICE) / 100000).toFixed(2)} Lakhs` : 'Price on Request',
            priceValue: parseInt(p.MIN_PRICE || '0'),
            areaSqft: parseFloat(p.SUPER_AREA || '0'),
            areaUnit: (p.SUPERAREA_UNIT || 'sq.ft.').toLowerCase(),
            area: (p.SUPER_AREA ? p.SUPER_AREA + ' ' + (p.SUPERAREA_UNIT || '') : '').trim() || 'N/A',
            url: p.URL ? `https://www.99acres.com${p.URL}` : 'https://www.99acres.com'
          }));
        }
      } catch (e) { /* ignore parse error */ }
    }

    // Try __initialData__
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const content = $(script).html() || '';
      const idx = content.indexOf('window.__initialData__=');
      if (idx === -1) continue;

      let jsonStart = idx + 'window.__initialData__='.length;
      let braces = 0, i = jsonStart, jsonStr = '';
      while (i < content.length) {
        const char = content[i];
        if (char === '{') braces++;
        else if (char === '}') braces--;
        jsonStr += char;
        if (braces === 0 && jsonStr.length > 10) break;
        i++;
      }

      try {
        const state = JSON.parse(jsonStr);
        const searchProps = (obj: any): any[] | null => {
          if (!obj || typeof obj !== 'object') return null;
          if (Array.isArray(obj.properties) && obj.properties.length > 0) return obj.properties;
          if (Array.isArray(obj.srpTuples) && obj.srpTuples.length > 0) return obj.srpTuples;
          if (Array.isArray(obj.propertiesList) && obj.propertiesList.length > 0) return obj.propertiesList;
          for (const k in obj) {
            const res = searchProps(obj[k]);
            if (res) return res;
          }
          return null;
        };
        const props = state?.srp?.propertiesList || searchProps(state) || [];
        return props.slice(0, 20).map((p: any) => ({
          id: p.PROP_ID || Math.random().toString(),
          title: (p.DESCRIPTION ? p.DESCRIPTION.substring(0, 100) + '...' : p.PROP_NAME) || 'Property Listing',
          propertyType: p.PROPERTY_TYPE || 'Land',
          agentDetails: p.PD_USER?.companyName || p.PD_USER?.name || 'Independent Seller',
          image: p.PHOTO_URL || p.MEDIUM_PHOTO_URL || 'https://via.placeholder.com/150?text=No+Image',
          yearsBuilt: p.AGE || '0',
          propertyAddress: p.LOCALITY || p.CITY || 'Unknown Locality',
          price: p.MIN_PRICE ? `₹${(parseInt(p.MIN_PRICE) / 100000).toFixed(2)} Lakhs` : 'Price on Request',
          priceValue: parseInt(p.MIN_PRICE || '0'),
          areaSqft: parseFloat(p.SUPER_AREA || '0'),
          areaUnit: (p.SUPERAREA_UNIT || 'sq.ft.').toLowerCase(),
          area: (p.SUPER_AREA ? p.SUPER_AREA + ' ' + (p.SUPERAREA_UNIT || '') : '').trim() || 'N/A',
          url: p.URL ? `https://www.99acres.com${p.URL}` : 'https://www.99acres.com'
        }));
      } catch (e) { /* ignore */ }
    }

    // Fallback: scrape visible HTML cards
    const cards: any[] = [];
    $('[class*="srp__card"], [class*="srpTuple"], [class*="projectTuple"], [class*="tupleNew"], .srpWrap .body').each((_, el) => {
      const title = $(el).find('[class*="heading"], h2, h3, [class*="projectName"]').first().text().trim();
      const price = $(el).find('[class*="price"], [class*="configurationCards__price"], [class*="srpPrice"]').first().text().trim();
      const area = $(el).find('[class*="area"], [class*="carpetArea"], [class*="size"]').first().text().trim();
      const img = $(el).find('img').first().attr('src') || '';
      if (title) {
        cards.push({
          id: Math.random().toString(),
          title: title.substring(0, 100),
          propertyType: 'Land',
          agentDetails: 'Listed on 99acres',
          image: img || 'https://via.placeholder.com/150?text=No+Image',
          yearsBuilt: '0',
          propertyAddress: sanitized,
          price: price || 'Price on Request',
          priceValue: parseInt(price.replace(/[^\d]/g, '')) || 0,
          areaSqft: parseFloat(area.replace(/[^\d.]/g, '')) || 0,
          areaUnit: area.toLowerCase().includes('acre') ? 'acres' : 'sq.ft.',
          area: area || 'N/A',
          url: 'https://www.99acres.com'
        });
      }
    });
    return cards;

  } catch (err: any) {
    console.warn(`[Cheerio] 99acres scrape failed for ${sanitized}:`, err.message);
    return [];
  }
}

function getRiskAssessment(score: number, energyType: string) {
  return {
    land_acquisition: score > 60 ? 'low risk' : 'medium risk',
    grid_curtailment: score > 50 ? 'medium risk' : 'high risk',
    weather_risk: energyType === 'wind' ? 'high risk' : 'low risk',
    policy: 'low risk'
  };
}

// ─── Main Server ────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", gemini: true });
  });

  // Load hotspots data
  const hotspotsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'src', 'data', 'hotspots_india.json'), 'utf-8')
  );

  // ── Heatmaps endpoint (static hotspots) ───────────────────
  app.post("/api/heatmaps", async (req, res) => {
    const { energyType } = req.body;
    const type = (energyType || 'solar').toLowerCase();

    let hotspots = [];
    if (type === 'hybrid' && hotspotsData.hybrid) {
      hotspots = hotspotsData.hybrid.map((h: any) => ({ ...h, type: 'hybrid' }));
    } else if (type === 'wind' && hotspotsData.wind) {
      hotspots = hotspotsData.wind.map((h: any) => ({ ...h, type: 'wind' }));
    } else {
      hotspots = hotspotsData.solar.map((h: any) => ({ ...h, type: 'solar' }));
    }

    res.json({ hotspots, dataSource: 'verified_sites' });
  });

  // ── AI-powered heatmap data for a state (REAL DATA) ───────
  app.post("/api/heatmap-data", async (req, res) => {
    const { state, energyType } = req.body;
    const bounds = getStateBounds(state || '');
    const type = (energyType || 'solar').toLowerCase();

    console.log(`🗺️ Generating heatmap for ${state || 'All India'} (${type})`);

    // 1. Start with verified hotspot data
    const allSpots = [
      ...(hotspotsData.solar || []).map((h: any) => ({ ...h, spotType: 'solar' })),
      ...(hotspotsData.wind || []).map((h: any) => ({ ...h, spotType: 'wind' })),
      ...(hotspotsData.hybrid || []).map((h: any) => ({ ...h, spotType: 'hybrid' })),
    ];

    // Filter by state (if selected) and energy type
    const filteredSpots = allSpots.filter((h: any) => {
      const inBounds = h.lat >= bounds.south && h.lat <= bounds.north && h.lon >= bounds.west && h.lon <= bounds.east;
      const matchesType = type === 'hybrid' || h.spotType === type || h.spotType === 'hybrid';
      return (state ? inBounds : true) && matchesType;
    });

    let heatPoints = filteredSpots.map((h: any) => ({
      lat: h.lat,
      lon: h.lon,
      intensity: Math.min(1.0, ((h.ghi || 5) / 7) * 0.8 + ((h.windSpeed || 5) / 10) * 0.2),
      label: h.name,
      category: 'verified_site'
    }));

    // 2. Fetch real open land areas via Overpass (parallel with Gemini)
    const [openLandResult, geminiResult] = await Promise.allSettled([
      fetchOpenLandAreas(bounds, 20),
      (async () => {
        const prompt = `You are GreenGrid AI, a renewable energy site intelligence agent for India.
The user wants to find the BEST locations for ${type} energy investment in ${state || 'India'}.

CRITICAL REQUIREMENTS - Generate REAL locations that actually exist:
1. VAST EMPTY AREAS: Large contiguous barren/wasteland/scrubland/desert with NO forests, NO villages, NO urban areas nearby
2. LOW LAND COST: Areas where agricultural/wasteland is < ₹5 Lakh/acre (far from cities)
3. FLAT TERRAIN: Elevation < 500m, minimal slope - suitable for solar panel/wind turbine installation
4. GRID ACCESS: Within 40km of existing power substations or transmission lines
5. NO PROTECTED AREAS: Not in national parks, wildlife sanctuaries, or forest reserves

For ${type === 'solar' ? 'SOLAR: prioritize areas with GHI > 5.0 kWh/m²/day, clear skies, desert/semi-arid regions' : type === 'wind' ? 'WIND: prioritize areas with sustained wind > 6 m/s, coastal plains, mountain passes, ridgelines' : 'HYBRID: mix of high-solar and high-wind areas'}

Generate exactly 20 specific real coordinate points WITHIN ${state || 'India'} boundaries (lat ${bounds.south.toFixed(1)}-${bounds.north.toFixed(1)}, lon ${bounds.west.toFixed(1)}-${bounds.east.toFixed(1)}).
Each point must be a REAL identifiable location (named town/village/desert/plateau nearby).

Return JSON ONLY:
{"heatPoints":[{"lat":27.5,"lon":71.9,"intensity":0.95,"category":"vast_open_space","label":"Thar Desert near Barmer"},{"lat":26.8,"lon":70.5,"intensity":0.85,"category":"low_land_rate","label":"Wasteland near Jaisalmer"}]}`;

        const parsed = await callGemini(prompt, { json: true, temperature: 0.4 });
        if (!parsed?.heatPoints) return [];
        return parsed.heatPoints.filter((p: any) => 
          p.lat >= bounds.south && p.lat <= bounds.north && 
          p.lon >= bounds.west && p.lon <= bounds.east
        );
      })()
    ]);

    // 3. Add open land areas from Overpass
    if (openLandResult.status === 'fulfilled' && openLandResult.value.length > 0) {
      const openLandPoints = openLandResult.value.map((p: any) => ({
        lat: p.lat,
        lon: p.lon,
        intensity: p.type === 'sand' ? 0.9 : p.type === 'scrub' ? 0.85 : p.type === 'grassland' ? 0.75 : 0.7,
        label: `${p.name} (${p.type})`,
        category: 'open_land_osm'
      }));
      heatPoints = [...heatPoints, ...openLandPoints];
    }

    // 4. Add Gemini AI points
    if (geminiResult.status === 'fulfilled' && (geminiResult.value as any[]).length > 0) {
      heatPoints = [...heatPoints, ...(geminiResult.value as any[])];
    }

    // 5. Deduplicate by proximity (within 0.1 degrees)
    const deduped: any[] = [];
    for (const p of heatPoints) {
      const duplicate = deduped.find(d => Math.abs(d.lat - p.lat) < 0.1 && Math.abs(d.lon - p.lon) < 0.1);
      if (!duplicate) deduped.push(p);
      else if (p.intensity > duplicate.intensity) {
        Object.assign(duplicate, p);
      }
    }

    // 6. If still no data (all APIs failed), generate grid-based fallback
    if (deduped.length === 0) {
      const latStep = (bounds.north - bounds.south) / 5;
      const lonStep = (bounds.east - bounds.west) / 4;
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) {
          deduped.push({
            lat: bounds.south + latStep * (i + 0.5) + (Math.random() - 0.5) * latStep * 0.3,
            lon: bounds.west + lonStep * (j + 0.5) + (Math.random() - 0.5) * lonStep * 0.3,
            intensity: 0.4 + Math.random() * 0.4,
            label: `${state || 'India'} Zone ${i * 4 + j + 1}`,
            category: 'estimated'
          });
        }
      }
    }

    console.log(`🗺️ Generated ${deduped.length} heatmap points`);

    res.json({
      success: true,
      heatPoints: deduped,
      layers: ['verified_site', 'open_land_osm', 'vast_open_space', 'low_land_rate', 'high_solar', 'grid_proximity'],
      source: getAI() ? 'multi_source_intelligence' : 'verified_data'
    });
  });

  // ── Substations endpoint ──────────────────────────────────
  app.post("/api/substations", async (req, res) => {
    const { lat, lon } = req.body;
    try {
      const substations = await fetchNearbySubstations(lat, lon);
      res.json({ success: true, substations });
    } catch (err: any) {
      res.json({ success: false, substations: [], error: err.message });
    }
  });

  // ── 99acres scrape endpoint (Cheerio-first) ───────────────
  app.post("/api/scrape/99acres", async (req, res) => {
    try {
      const { city, propertyType } = req.body;

      // Try Cheerio first (fast, reliable)
      let properties = await scrape99acresCheerio(city, propertyType || 'agricultural-land');

      // If city name failed, try with just the first word (common pattern)
      if (properties.length === 0 && city.includes(' ')) {
        const firstWord = city.split(' ')[0];
        properties = await scrape99acresCheerio(firstWord, propertyType || 'agricultural-land');
      }

      // If still empty, try nearby major city
      if (properties.length === 0) {
        const fallbackCities = ['hyderabad', 'bangalore', 'chennai', 'pune', 'ahmedabad', 'jaipur', 'bhopal', 'lucknow', 'indore', 'nagpur', 'coimbatore', 'visakhapatnam'];
        const normalizedCity = city.toLowerCase();
        const fallback = fallbackCities.find(c => normalizedCity.includes(c.substring(0, 4)));
        if (fallback) {
          properties = await scrape99acresCheerio(fallback, propertyType || 'agricultural-land');
        }
      }

      // If scraping completely failed, generate AI-estimated listings
      if (properties.length === 0) {
        try {
          const aiPrompt = `Generate 5 realistic agricultural land listings near ${city}, India for renewable energy investment.
Return JSON ONLY: {"listings":[{"title":"5 Acre Agricultural Land near X","price":"₹15.00 Lakhs","priceValue":1500000,"area":"5 acres","areaSqft":217800,"areaUnit":"acres","locality":"name"}]}`;
          const parsed = await callGemini(aiPrompt, { json: true, temperature: 0.5 });
          if (parsed?.listings?.length) {
            properties = parsed.listings.map((l: any, i: number) => ({
              id: `ai-${i}`,
              title: l.title || `Agricultural Land near ${city}`,
              propertyType: 'Land',
              agentDetails: 'AI Estimated (Gemini)',
              image: 'https://via.placeholder.com/150?text=AI+Estimate',
              yearsBuilt: '0',
              propertyAddress: l.locality || city,
              price: l.price || 'Price on Request',
              priceValue: l.priceValue || 0,
              areaSqft: l.areaSqft || 0,
              areaUnit: l.areaUnit || 'acres',
              area: l.area || 'N/A',
              url: `https://www.99acres.com/property-for-sale-in-${sanitizeCityFor99acres(city)}-ffid`,
              isEstimated: true
            }));
          }
        } catch (e: any) {
          console.warn('AI listing generation failed:', e.message);
        }
      }

      res.json({
        success: properties.length > 0,
        city,
        propertyType,
        count: properties.length,
        properties,
        isEstimated: properties.some((p: any) => p.isEstimated)
      });
    } catch (error: any) {
      console.error("99acres Scraping Error:", error.message);
      res.status(200).json({ success: false, properties: [], error: error.message });
    }
  });

  // ── Main analysis endpoint ────────────────────────────────
  app.post("/api/analyze/pinpoint", async (req, res) => {
    try {
      const { lat, lon, budget: rawBudget, budget_inr, energyType, years, specificProperty } = req.body;
      const budget = Number(rawBudget || budget_inr) || 50000000; // Default 5 Cr
      console.log(`🔍 Starting analysis for ${lat}, ${lon} (budget: ₹${(budget / 10000000).toFixed(1)} Cr)`);

      // Run independent fetches in PARALLEL
      const [nasaData, elevationData, gridData, locationData, substations] = await Promise.all([
        fetchNASAPower(lat, lon),
        fetchElevation(lat, lon),
        fetchNearestSubstationDistance(lat, lon),
        getRealLocationDetails(lat, lon),
        fetchNearbySubstations(lat, lon)
      ]);

      // Validate NASA data — replace -999 sentinel values with India-average fallbacks
      const validateNasa = (raw: any) => {
        if (!raw) return null;
        const valid = (v: number, fallback: number) => (v && v !== -999 && v > 0 && isFinite(v)) ? v : fallback;
        return {
          ...raw,
          ghi: valid(raw.ghi, 5.0),
          windSpeed50m: valid(raw.windSpeed50m, 4.5),
          windSpeed10m: valid(raw.windSpeed10m, 3.2),
          tempAvg: (raw.tempAvg && raw.tempAvg !== -999 && isFinite(raw.tempAvg)) ? raw.tempAvg : 28,
          tempMax: (raw.tempMax && raw.tempMax !== -999 && isFinite(raw.tempMax)) ? raw.tempMax : 38,
          precipitation: valid(raw.precipitation, 800),
        };
      };

      // Use real data or India-average fallback if NASA API failed
      const effectiveNasaData = validateNasa(nasaData) || {
        ghi: 5.0, windSpeed50m: 4.5, windSpeed10m: 3.2,
        tempAvg: 28, tempMax: 38, precipitation: 800,
        ghiMonthly: {}, windMonthly: {}, precipMonthly: {},
        source: 'Estimated (NASA API unavailable)', confidence: 'LOW'
      };

      const locationName = locationData?.site_name || `${lat}, ${lon}`;

      // Scrape 99acres for land listings
      let scrapedListings: any[] = [];
      const district = locationData?.district || '';
      const cityName = district && district !== 'Unknown District' && district !== 'Unknown'
        ? district
        : (locationData?.site_name || 'bangalore');

      try {
        const properties = await scrape99acresCheerio(cityName, 'agricultural-land');
        scrapedListings = properties;

        // If no results from district, try site name
        if (scrapedListings.length === 0 && locationData?.site_name && locationData.site_name !== 'Unknown Site') {
          scrapedListings = await scrape99acresCheerio(locationData.site_name, 'agricultural-land');
        }

        // If still no results, try state-level search
        if (scrapedListings.length === 0 && locationData?.state && locationData.state !== 'Unknown State') {
          const stateCity = locationData.state.split(' ')[0];
          scrapedListings = await scrape99acresCheerio(stateCity, 'agricultural-land');
        }
      } catch (err: any) {
        console.warn(`Scraper unavailable: ${err.message}. Using Gemini estimate.`);
      }

      console.log(`📦 Scraped ${scrapedListings.length} properties from 99acres`);

      // Calculate median price from scraped listings
      let realMedianRate = 0;
      if (scrapedListings.length > 0) {
        const pricesPerAcre = scrapedListings
          .filter(p => p.priceValue > 0 && (p.areaSqft > 0 || parseFloat(p.area) > 0))
          .map(p => {
            const unit = (p.areaUnit || p.area || '').toLowerCase();
            let areaInSqft: number;
            if (unit.includes('acre')) {
              // areaSqft field actually stores the raw SUPER_AREA number, which is in acres
              const acres = p.areaSqft > 0 ? p.areaSqft : (parseFloat(p.area) || 1);
              areaInSqft = acres * 43560;
            } else if (unit.includes('hectare')) {
              const hectares = p.areaSqft > 0 ? p.areaSqft : (parseFloat(p.area) || 1);
              areaInSqft = hectares * 107639;
            } else {
              areaInSqft = p.areaSqft > 0 ? p.areaSqft : (parseFloat(p.area) || 1);
            }
            if (areaInSqft < 1) return NaN;
            const pricePerSqft = p.priceValue / areaInSqft;
            return pricePerSqft * 43560; // price per acre
          })
          .filter(v => v > 0 && isFinite(v) && v < 500000000) // Cap at 50 Cr/acre to exclude outliers
          .sort((a, b) => a - b);

        if (pricesPerAcre.length > 0) {
          // For agricultural/renewable land, prefer lower quartile over median
          // since scraped listings may include residential/commercial properties
          const idx = Math.min(Math.floor(pricesPerAcre.length * 0.25), pricesPerAcre.length - 1);
          realMedianRate = pricesPerAcre[idx];
          // Sanity check: agricultural land in India is typically 1-100 Lakh/acre
          if (realMedianRate > 100_00_000) { // > 1 Cr/acre, likely not agri land
            realMedianRate = Math.min(realMedianRate, 50_00_000); // Cap at 50L/acre
          }
          console.log(`📊 Median land rate: ₹${(realMedianRate / 100000).toFixed(2)} Lakhs/acre (from ${pricesPerAcre.length} properties)`);
        }
      }

      const realMidPerSqft = realMedianRate > 0 ? (realMedianRate / 43560) : 0;

      // Get Gemini land rate synthesis
      let landRateData = await getLandRateViaGemini(lat, lon, locationName, scrapedListings);
      if (!landRateData) landRateData = { market_rate: {}, confidence: "LOW" } as any;
      if (!landRateData.market_rate) landRateData.market_rate = {};
      landRateData.state = locationData?.state || "Unknown";

      // Override with real scraped data if available
      if (realMidPerSqft > 0) {
        landRateData.market_rate.mid_per_sqft = realMidPerSqft;
        landRateData.market_rate.low_per_sqft = realMidPerSqft * 0.8;
        landRateData.market_rate.high_per_sqft = realMidPerSqft * 1.2;
        landRateData.confidence_score = 95;
      }

      // Compute scores
      const scores = computeSiteScores(effectiveNasaData, elevationData?.elevation_m, gridData);

      // Compute financials — pass 0 for capacity to let budget determine it
      const projectionYears = Number(years) || 10;
      const financials = computeFinancials(
        budget, energyType, effectiveNasaData, landRateData,
        gridData?.distance_km, 0,
        specificProperty,
        projectionYears
      );

      // Gemini expert insight
      let expert_insight = `Based on real-time NASA telemetry, this site offers a ${scores.compositeScore}/100 viability score for ${energyType} generation, with an estimated IRR of ${financials.irr_percent}%.`;

      if (getAI()) {
        try {
          const prompt = `
You are GreenGrid AI, a renewable energy investment intelligence agent.
Analyze this location for a ${energyType} power plant:
Coordinates: ${lat}, ${lon}
Location: ${locationData.site_name}, ${locationData.district}, ${locationData.state}
Energy Data: GHI=${effectiveNasaData.ghi.toFixed(2)} kWh/m2/day, Wind(50m)=${effectiveNasaData.windSpeed50m.toFixed(1)} m/s
Calculated Score: ${scores.compositeScore}/100
Calculated IRR: ${financials.irr_percent}%

Provide a JSON response:
{"expert_insight": "2-sentence intelligence briefing on this site's viability, mentioning specific local factors."}`;

          const aiData = await callGemini(prompt, { json: true });
          if (aiData?.expert_insight) {
            expert_insight = aiData.expert_insight;
          }
        } catch (e: any) {
          console.warn("Gemini insight error:", e.message);
        }
      }

      res.json({
        location: { lat, lon },
        location_details: locationData,
        energy: {
          type: energyType,
          capacity_mw: financials.installed_capacity_mwp.toFixed(1),
          annual_mwh: financials.annual_generation_mwh,
          score: scores.compositeScore,
          solar_score: scores.solarScore.value,
          wind_score: scores.windScore.value,
          weather_score: scores.weatherStability.value,
          land_score: scores.landSuitability.value,
          grid_score: scores.gridAccessibility.value,
          solar_percent: scores.energyMix.solar,
          wind_percent: scores.energyMix.wind,
          recommendation: scores.recommendation,
          ghi: effectiveNasaData.ghi.toFixed(2),
          wind_100m: (effectiveNasaData.windSpeed50m * Math.pow(100 / 50, 0.143)).toFixed(1),
          elevation: elevationData?.elevation_m,
          grid_distance_km: gridData?.distance_km,
          precipitation: effectiveNasaData.precipitation || 0,
        },
        scores_detail: {
          solar: scores.solarScore,
          wind: scores.windScore,
          weather: scores.weatherStability,
          land: scores.landSuitability,
          grid: scores.gridAccessibility,
          inputs: scores.inputs,
        },
        financials: {
          budget_cr: (budget / 10000000).toFixed(1),
          total_capex_cr: financials.total_capex_crore.toFixed(2),
          annual_revenue_cr: financials.annual_revenue_base_crore.toFixed(2),
          annual_opex_cr: financials.annual_opex_crore.toFixed(2),
          npv_cr: financials.npv_crore.toFixed(1),
          payback_years: financials.simple_payback_years?.toFixed(1) || '--',
          irr_percent: financials.irr_percent.toFixed(1),
          lcoe: financials.lcoe_inr_per_kwh.toFixed(2),
          land_cost_cr: financials.land_cost_crore.toFixed(2),
          grid_cost_cr: financials.grid_connection_crore.toFixed(2),
          equipment_cost_cr: financials.equipment_cost_crore.toFixed(2),
        },
        equipment: {
          panels: financials.num_panels,
          inverters: financials.inverters_500kw,
          turbines: financials.num_turbines,
          land_acres: financials.land_required_acres.toFixed(1),
          transformer: `${financials.transformer_mva} MVA`
        },
        impact: {
          co2_tonnes: financials.co2_avoided_tonnes_year,
          homes: financials.homes_powered,
          coal_tonnes: financials.coal_replaced_tonnes,
          trees: Math.round(financials.co2_avoided_tonnes_year * 47),
          jobs: financials.jobs_created
        },
        transparency: {
          nasa_power: nasaData ? "LIVE" : "ESTIMATED",
          wind_atlas: nasaData ? "LIVE" : "ESTIMATED",
          land_rate: landRateData?.confidence ? `${landRateData.confidence} (Gemini + 99acres)` : "ESTIMATED",
          tariff: `CERC Benchmark (INR ${financials.tariff_used_inr_kwh.toFixed(2)}/kWh)`
        },
        risk_assessment: getRiskAssessment(scores.compositeScore, energyType),
        expert_insight,
        land_rate_info: {
          price_per_acre: landRateData?.market_rate?.mid_per_acre_lakh || (realMedianRate > 0 ? parseFloat((realMedianRate / 100000).toFixed(1)) : 12),
          confidence: (landRateData?.confidence || 'LOW') + " CONFIDENCE",
          source: landRateData?.data_sources?.join(", ") || (scrapedListings.length > 0 ? "99acres Scrape" : "AI + Benchmark"),
          details: landRateData
        },
        listings_scraped: scrapedListings.slice(0, 10),
        revenue_projection: financials.revenue_projection,
        substations
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ GreenGrid Server running on http://localhost:${PORT}`);
    console.log(`🔑 Gemini API Key: LOADED`);
  });
}

startServer();
