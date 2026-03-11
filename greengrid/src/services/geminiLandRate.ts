import { GoogleGenAI } from "@google/genai";

const HARDCODED_KEY = 'AIzaSyCsfhA4ZgAwzXSExcETq1XTcMQsmlUZxWY';

export async function getLandRateViaGemini(lat: number, lon: number, locationName: string, scrapedListings: any[]) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || HARDCODED_KEY;
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Prepare the scraped data as context for Gemini
  const listingsContext = scrapedListings.length > 0
    ? scrapedListings.slice(0, 15).map(l =>
      `- ${l.title || l.address}: ₹${l.price}, Area: ${l.area}`
    ).join('\n')
    : 'No listings scraped — use web knowledge for this location.';

  const prompt = `
You are a real estate data analyst for India. A user has clicked on coordinates ${lat}, ${lon} 
near ${locationName} to assess land rates for a renewable energy investment project.

SCRAPED LISTINGS FROM 99ACRES (${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}):
${listingsContext}

Based on these listings AND your knowledge of current land rates in this area as of ${new Date().getFullYear()}:

Provide a JSON response ONLY (no markdown, no explanation) in exactly this format:
{
  "location_name": "specific locality/area name",
  "market_rate": {
    "low_per_sqft": <number>,
    "mid_per_sqft": <number>, 
    "high_per_sqft": <number>,
    "low_per_acre_lakh": <number>,
    "mid_per_acre_lakh": <number>,
    "high_per_acre_lakh": <number>,
    "currency": "INR"
  },
  "land_type": "agricultural|residential|commercial|wasteland",
  "listings_count": <number of scraped listings used>,
  "yoy_trend": "+X%|-X%|stable",
  "trend_driver": "brief reason for price trend",
  "circle_rate_per_sqft": <government guideline value if known, else null>,
  "acquisition_premium": <multiplier over circle rate, e.g. 1.4>,
  "data_sources": ["99acres listings", "market knowledge"],
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_reason": "brief explanation",
  "special_notes": "any relevant notes for renewable energy investor",
  "last_updated": "${new Date().toISOString().split('T')[0]}"
}`;

  const MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
          topK: 1,
          topP: 0.8
        }
      });

      let rawText = response.text || "{}";
      const cleanJson = rawText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        console.warn(`[GeminiLandRate] Rate limited on ${model}, trying next...`);
        continue;
      }
      if (msg.includes('API key not valid')) {
        console.warn('Gemini API key is invalid. Falling back to regional benchmarks.');
        break;
      }
      console.error(`[GeminiLandRate] Error with ${model}:`, msg.substring(0, 200));
      continue;
    }
  }
  // All models failed — return a reasonable fallback
  return {
    location_name: locationName,
    market_rate: {
      low_per_sqft: 15,
      mid_per_sqft: 30,
      high_per_sqft: 60,
      low_per_acre_lakh: 6,
      mid_per_acre_lakh: 12,
      high_per_acre_lakh: 25,
      currency: 'INR'
    },
    land_type: 'agricultural',
    confidence: 'LOW',
    confidence_reason: 'AI estimation unavailable, using national benchmarks',
    data_sources: ['National Agricultural Benchmark'],
    last_updated: new Date().toISOString().split('T')[0]
  };
}
