function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export async function fetchNearestSubstationDistance(lat: number, lon: number) {
  // Overpass API — free, queries OpenStreetMap power infrastructure
  const query = `
    [out:json][timeout:25];
    (
      node["power"="substation"](around:100000,${lat},${lon});
      way["power"="substation"](around:100000,${lat},${lon});
    );
    out center 5;
  `;
  
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (!data.elements || !data.elements.length) {
      return { distance_km: null, confidence: 'LOW', note: 'No substation data in OSM for this area' };
    }
    
    // Find nearest substation
    let nearest = Infinity;
    let nearestInfo: any = null;
    
    for (const el of data.elements) {
      const elLat = el.lat || el.center?.lat;
      const elLon = el.lon || el.center?.lon;
      if (!elLat) continue;
      
      const dist = haversineKm(lat, lon, elLat, elLon);
      if (dist < nearest) {
        nearest = dist;
        nearestInfo = {
          distance_km: parseFloat(nearest.toFixed(2)),
          voltage: el.tags?.voltage || 'unknown',
          name: el.tags?.name || 'Unnamed substation',
          source: 'OpenStreetMap via Overpass API',
          confidence: 'MEDIUM'
        };
      }
    }
    return nearestInfo || { distance_km: 15, confidence: 'LOW', note: 'Estimated' };
  } catch (err) {
    return { distance_km: 15, confidence: 'LOW', note: 'Estimated — Overpass API unavailable' };
  }
}
