export async function fetchNASAPower(lat: number, lon: number) {
  const params = new URLSearchParams({
    parameters: 'ALLSKY_SFC_SW_DWN,WS50M,WS10M,T2M,T2M_MAX,PRECTOTCORR',
    community: 'RE',
    longitude: lon.toString(),
    latitude: lat.toString(),
    format: 'JSON',
    start: '2010',
    end: '2023'
  });

  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?${params}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    const p = data.properties.parameter;
    
    // Calculate annual precipitation (sum of monthly mm/day × days)
    const precipMonthly = p.PRECTOTCORR || {};
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const monthKeys = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    let annualPrecipitation = 0;
    monthKeys.forEach((key, i) => {
      if (precipMonthly[key] !== undefined && precipMonthly[key] !== -999) {
        annualPrecipitation += precipMonthly[key] * daysInMonth[i];
      }
    });
    // Fallback to ANN value if available
    if (annualPrecipitation === 0 && precipMonthly.ANN !== undefined && precipMonthly.ANN !== -999) {
      annualPrecipitation = precipMonthly.ANN * 365;
    }

    return {
      ghi: p.ALLSKY_SFC_SW_DWN.ANN,
      windSpeed50m: p.WS50M.ANN,
      windSpeed10m: p.WS10M.ANN,
      tempAvg: p.T2M.ANN,
      tempMax: p.T2M_MAX.ANN,
      precipitation: annualPrecipitation, // mm/year
      ghiMonthly: p.ALLSKY_SFC_SW_DWN,
      windMonthly: p.WS50M,
      precipMonthly: p.PRECTOTCORR,
      source: 'NASA POWER Climatology API (2010-2023)',
      confidence: 'HIGH'
    };
  } catch (err) {
    console.error('NASA POWER fetch failed:', err);
    return null;
  }
}
