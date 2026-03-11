export async function fetchElevation(lat: number, lon: number) {
  // OpenTopoData — free, no key, covers India with SRTM 30m data
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lon}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    return {
      elevation_m: data.results[0].elevation,
      dataset: 'SRTM 30m (USGS)',
      confidence: 'HIGH'
    };
  } catch {
    // Fallback: Open-Elevation API
    try {
      const fallback = await fetch(
        `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`
      );
      const fdata = await fallback.json();
      return {
        elevation_m: fdata.results[0].elevation,
        dataset: 'Open-Elevation (fallback)',
        confidence: 'MEDIUM'
      };
    } catch (e) {
      return {
        elevation_m: 300,
        dataset: 'Estimated',
        confidence: 'LOW'
      };
    }
  }
}
