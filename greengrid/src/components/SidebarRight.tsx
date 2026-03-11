import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Download, Bookmark, Activity, MapPin, Zap, Mountain, ActivitySquare, RefreshCw, ShieldAlert, IndianRupee, Search, BarChart3, Shield, Info } from 'lucide-react';
import ReportExport from './ReportExport';

interface SidebarRightProps {
  result: any;
  selectedLocation: { lat: number; lon: number } | null;
  onReanalyze: () => void;
  isLoading: boolean;
  onOpenDashboard?: () => void;
}

export default function SidebarRight({ result, selectedLocation, onReanalyze, isLoading, onOpenDashboard }: SidebarRightProps) {
  const [isScraping, setIsScraping] = useState(false);
  const [scrapedData, setScrapedData] = useState<any>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  if (!result && !selectedLocation) {
    return (
      <div className="w-96 bg-black border-l border-[#1A1A1A] flex flex-col items-center justify-center p-8 text-center text-gray-500 font-mono text-xs">
        <Activity className="w-8 h-8 text-[#1A1A1A] mb-4" />
        <p>AWAITING TELEMETRY</p>
      </div>
    );
  }

  // Use mock data if result is not yet available, but location is selected
  const data = result || {
    location_details: { site_name: 'Analyzing...', state: 'Loading', district: 'Loading' },
    energy: { score: 0, capacity_mw: '0.1', annual_mwh: 0, type: 'solar', ghi: '0', wind_100m: '0', elevation: 0, grid_distance_km: 0, solar_percent: 50, wind_percent: 50 },
    financials: { annual_revenue_cr: '0', irr_percent: '0', payback_years: '0', lcoe: '0' },
    equipment: { panels: 0, inverters: 0, land_acres: '0.5', transformer: '1 MVA', turbines: 0 },
    impact: { co2_tonnes: 0, homes: 0, jobs: 0, trees: 0 },
    transparency: { nasa_power: 'WAITING', wind_atlas: 'WAITING', land_rate: 'WAITING', tariff: 'WAITING' },
    risk_assessment: { land_acquisition: 'pending', grid_curtailment: 'pending', weather_risk: 'pending', policy: 'pending' },
    expert_insight: 'Click "Analyze Location" to generate intelligence for this coordinate.',
    land_rate_info: { price_per_acre: 12, confidence: 'WAITING', source: 'WAITING' }
  };

  const { location_details, energy, financials, equipment, impact, transparency, risk_assessment, expert_insight, land_rate_info } = data;

  const handleScrape = async () => {
    if (!location_details?.district || location_details.district === 'Unknown') {
      setScrapeError("Valid district required for scraping.");
      return;
    }

    setIsScraping(true);
    setScrapeError(null);
    setScrapedData(null);

    try {
      // Clean up district name and try multiple search strategies
      const district = location_details.district || 'Unknown';
      const city = district !== 'Unknown' ? district.split(' ')[0] : (location_details.site_name || 'bangalore').split(' ')[0];

      const response = await fetch('/api/scrape/99acres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, propertyType: 'agricultural-land' }),
      });

      const data = await response.json();

      if (data.success && data.properties && data.properties.length > 0) {
        setScrapedData(data);
      } else {
        // Try with state name as fallback
        const stateName = (location_details.state || '').split(' ')[0].toLowerCase();
        if (stateName && stateName !== 'unknown') {
          const fallbackRes = await fetch('/api/scrape/99acres', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ city: stateName, propertyType: 'agricultural-land' }),
          });
          const fallbackData = await fallbackRes.json();
          if (fallbackData.success && fallbackData.properties?.length > 0) {
            setScrapedData(fallbackData);
          } else {
            setScrapeError(`No listings found for ${city}. Land rates shown are from AI estimates.`);
          }
        } else {
          setScrapeError(`No listings found for ${city}. Land rates shown are from AI estimates.`);
        }
      }
    } catch (error: any) {
      setScrapeError(error.message || "Network error during scraping");
    } finally {
      setIsScraping(false);
    }
  };

  // Revenue chart: always generate meaningful data
  const annualRev = parseFloat(financials.annual_revenue_cr || '0');
  const chartData = data.revenue_projection && data.revenue_projection.length > 0
    ? data.revenue_projection.map((r: any, i: number) => ({ year: i + 1, revenue: parseFloat((r.revenue_cr || r.revenue || r).toString()) || annualRev }))
    : Array.from({ length: 10 }, (_, i) => ({
        year: i + 1,
        revenue: parseFloat((Math.max(0.01, annualRev) * Math.pow(1.03, i) * (1 - i * 0.003)).toFixed(2)),
      }));

  const isSolar = energy.type === 'solar' || energy.type === 'hybrid';
  const isWind = energy.type === 'wind' || energy.type === 'hybrid';

  const getRiskColor = (risk: string) => {
    if (!risk) return 'text-gray-500';
    if (risk.includes('low')) return 'text-[#00FF41]';
    if (risk.includes('high')) return 'text-red-500';
    return 'text-yellow-500';
  };

  return (
    <div className="w-96 bg-black border-l border-[#1A1A1A] flex flex-col h-full text-gray-300 overflow-y-auto font-mono text-xs">
      {/* Header */}
      <div className="p-4 border-b border-[#1A1A1A]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[#00FF41]">
            <Activity className="w-4 h-4" />
            <span className="tracking-widest uppercase">Live Analysis</span>
          </div>
          <button 
            onClick={onReanalyze} 
            disabled={isLoading}
            className="flex items-center gap-2 text-[10px] text-[#00FF41] hover:text-[#00FF41]/80 transition-colors bg-[#00FF41]/5 px-2 py-1 rounded border border-[#00FF41]/20"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            REASSESS
          </button>
        </div>
        <h2 className="text-white text-lg font-bold mb-1">{location_details?.site_name || 'Selected Location'}</h2>
        <div className="flex items-center gap-1 text-gray-500">
          <MapPin className="w-3 h-3" />
          <span>{location_details?.state || 'Unknown'}, {location_details?.district || 'Unknown'} · {selectedLocation?.lat.toFixed(4)}°N, {selectedLocation?.lon.toFixed(4)}°E</span>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Expert Insight */}
        {expert_insight && (
          <div className="bg-[#00FF41]/10 border border-[#00FF41]/30 p-3 rounded text-[#00FF41] italic">
            "{expert_insight}"
          </div>
        )}

        {/* Score & Multi-Source Breakdown */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path className="text-[#1A1A1A]" strokeWidth="3" stroke="currentColor" fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  <path className="text-[#00FF41]" strokeDasharray={`${energy.score === '--' ? 0 : energy.score}, 100`}
                    strokeWidth="3" stroke="currentColor" fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-white text-xl font-bold">{energy.score}</span>
                </div>
              </div>
              <div>
                <div className="text-gray-500 uppercase text-[10px]">Composite Score</div>
                <div className="text-gray-400 text-[9px]">{energy.recommendation || 'Calculating...'}</div>
              </div>
            </div>
          </div>

          {/* Individual Score Bars with Trust Indicators */}
          {data.scores_detail && (
            <div className="space-y-2 mt-3">
              {([
                { key: 'solar', label: 'Solar', color: '#FFD700', score: data.scores_detail.solar },
                { key: 'wind', label: 'Wind', color: '#00BFFF', score: data.scores_detail.wind },
                { key: 'weather', label: 'Weather', color: '#66BB6A', score: data.scores_detail.weather },
                { key: 'land', label: 'Land', color: '#A1887F', score: data.scores_detail.land },
                { key: 'grid', label: 'Grid Access', color: '#FF9500', score: data.scores_detail.grid },
              ] as const).map(item => (
                <div key={item.key} className="group">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-400 text-[10px]">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-[10px] font-bold">{item.score?.value ?? '--'}</span>
                      <span className={`text-[8px] px-1 rounded ${
                        item.score?.confidence === 'HIGH' ? 'bg-[#00FF41]/20 text-[#00FF41]' :
                        item.score?.confidence === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{item.score?.confidence || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="w-full bg-[#1A1A1A] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all duration-500" style={{
                      width: `${item.score?.value || 0}%`,
                      backgroundColor: item.color
                    }} />
                  </div>
                  <div className="text-[8px] text-gray-600 mt-0.5 hidden group-hover:block">
                    {item.score?.source} · {item.score?.details}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Energy Mix */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1A1A1A]">
            <div className="text-gray-500 uppercase text-[10px]">Mix</div>
            <div className="flex-1 bg-[#1A1A1A] rounded-full h-2 flex overflow-hidden">
              <div className="bg-[#FFD700] h-full" style={{ width: `${energy.solar_percent ?? 0}%` }} />
              <div className="bg-[#00BFFF] h-full" style={{ width: `${energy.wind_percent ?? 0}%` }} />
            </div>
            <div className="flex gap-3 text-[9px]">
              <span className="text-[#FFD700]">☀ {energy.solar_percent ?? 0}%</span>
              <span className="text-[#00BFFF]">🌬 {energy.wind_percent ?? 0}%</span>
            </div>
          </div>
        </div>

        {/* Site Stats — Bug 5 fix: Added tooltip explanations for each metric */}
        <div className="grid grid-cols-3 gap-4 py-4 border-y border-[#1A1A1A]">
          <div className="text-center" title="Height above sea level. Flat terrain (< 500m) is ideal for solar. Higher elevations may increase installation costs.">
            <Mountain className="w-4 h-4 mx-auto mb-1 text-gray-500" />
            <div className="text-white font-bold text-sm">{energy.elevation}m</div>
            <div className="text-gray-500 cursor-help">Elevation ⓘ</div>
          </div>
          <div className="text-center border-x border-[#1A1A1A]" title="Distance to the nearest electrical substation. < 5km is excellent (low connectivity cost). > 20km adds significant transmission costs.">
            <ActivitySquare className="w-4 h-4 mx-auto mb-1 text-gray-500" />
            <div className="text-white font-bold text-sm">{energy.grid_distance_km}km</div>
            <div className="text-gray-500 cursor-help">Grid Dist. ⓘ</div>
          </div>
          <div className="text-center" title={energy.type === 'wind' ? 'Average wind speed at 100m hub height. > 6 m/s is commercially viable. > 8 m/s is excellent.' : 'Global Horizontal Irradiance — daily solar energy per m². > 5.0 kWh/m²/day is excellent for India. Bhadla gets ~5.8.'}>
            <Zap className="w-4 h-4 mx-auto mb-1 text-gray-500" />
            <div className="text-white font-bold text-sm">{energy.type === 'wind' ? energy.wind_100m : energy.ghi}</div>
            <div className="text-gray-500 cursor-help">{energy.type === 'wind' ? 'm/s (100m) ⓘ' : 'GHI kWh/m² ⓘ'}</div>
          </div>
        </div>

        {/* Land Acquisition Cost */}
        {land_rate_info && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-gray-500 tracking-widest uppercase flex items-center gap-2">
                <IndianRupee className="w-3 h-3" /> Land Acquisition Cost
              </h3>
              <button
                onClick={handleScrape}
                disabled={isScraping}
                className="text-[#00FF41] hover:text-white transition-colors flex items-center gap-1 text-[10px] uppercase border border-[#00FF41]/30 px-2 py-1 rounded disabled:opacity-50"
              >
                {isScraping ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {isScraping ? 'Scraping...' : 'Live 99Acres Data'}
              </button>
            </div>

            {scrapeError && (
              <div className="bg-red-900/20 border border-red-500/30 text-red-400 p-2 rounded mb-2 text-[10px]">
                {scrapeError}
              </div>
            )}

            {scrapedData && scrapedData.properties && scrapedData.properties.length > 0 && (
              <div className="bg-[#00FF41]/5 border border-[#00FF41]/20 p-2 rounded mb-2 max-h-64 overflow-y-auto custom-scrollbar">
                <div className="text-[#00FF41] text-[10px] mb-2 font-bold flex justify-between">
                  <span>LIVE LISTINGS ({scrapedData.city})</span>
                  <span>{scrapedData.count} found</span>
                </div>
                <div className="space-y-2">
                  {scrapedData.properties.slice(0, 3).map((prop: any, idx: number) => (
                    <a key={idx} href={prop.url} target="_blank" rel="noreferrer" className="block border border-[#1A1A1A] bg-black/40 rounded p-2 hover:border-[#00FF41]/40 transition-colors">
                      <div className="flex gap-2">
                        {prop.image && prop.image !== 'https://via.placeholder.com/150?text=No+Image' ? (
                          <img src={prop.image} alt="Property" className="w-12 h-12 object-cover rounded opacity-80" />
                        ) : (
                          <div className="w-12 h-12 bg-gray-800 rounded flex items-center justify-center text-gray-500 text-[8px]">No Img</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-[10px] truncate font-medium mb-1" title={prop.title}>{prop.title}</div>
                          <div className="flex justify-between text-gray-400 text-[9px] mb-1">
                            <span className="text-[#00FF41]">{prop.price}</span>
                            <span>{prop.area}</span>
                          </div>
                          <div className="flex justify-between text-gray-500 text-[8px]">
                            <span className="truncate max-w-[80px]" title={prop.agentDetails}>{prop.agentDetails}</span>
                            <span>{prop.propertyType}</span>
                          </div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {scrapedData && scrapedData.properties && scrapedData.properties.length === 0 && (
              <div className="bg-yellow-900/20 border border-yellow-500/30 text-yellow-400 p-2 rounded mb-2 text-[10px]">
                No listings found for {scrapedData.city}.
              </div>
            )}

            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Estimated Rate</span>
                <span className="text-white font-bold">₹{land_rate_info.price_per_acre} Lakh/Acre</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Required Area</span>
                <span className="text-white">{equipment.land_acres} Acres</span>
              </div>
              <div className="flex justify-between items-center border-t border-[#1A1A1A] pt-2">
                <span className="text-gray-400">Total Land Cost</span>
                <span className="text-[#00FF41] font-bold">
                  ₹{equipment.land_acres !== '--' && land_rate_info.price_per_acre !== '--'
                    ? ((parseFloat(equipment.land_acres) * parseFloat(land_rate_info.price_per_acre)) / 100).toFixed(2)
                    : '--'} Cr
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Financial Projections */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-gray-500 tracking-widest uppercase flex items-center gap-2">
              <Activity className="w-3 h-3" /> Financial Projections
            </h3>
            {onOpenDashboard && result && (
              <button
                onClick={onOpenDashboard}
                className="text-[#00FF41] hover:text-white transition-colors flex items-center gap-1 text-[10px] uppercase border border-[#00FF41]/30 px-2 py-1 rounded"
              >
                <BarChart3 className="w-3 h-3" /> Analytics
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 flex items-center gap-1 text-[9px]"><Zap className="w-3 h-3" /> CAPACITY</div>
              <div className="text-[#00FF41] text-lg font-bold">{energy.capacity_mw} MWp</div>
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 flex items-center gap-1 text-[9px]"><Activity className="w-3 h-3" /> ANNUAL GEN</div>
              <div className="text-[#00FF41] text-lg font-bold">{energy.annual_mwh >= 1000 ? (energy.annual_mwh/1000).toFixed(1) + ' GWh' : energy.annual_mwh + ' MWh'}</div>
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 text-[9px]">REVENUE</div>
              <div className="text-[#00FF41] text-lg font-bold">₹{financials.annual_revenue_cr} Cr</div>
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 text-[9px]">IRR</div>
              <div className="text-[#00FF41] text-lg font-bold">{financials.irr_percent}%</div>
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 text-[9px]">PAYBACK</div>
              <div className="text-[#00FF41] text-lg font-bold">{financials.payback_years} yrs</div>
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded">
              <div className="text-gray-500 mb-1 text-[9px]">LCOE</div>
              <div className="text-[#00FF41] text-lg font-bold">₹{financials.lcoe}/kWh</div>
            </div>
          </div>

          {/* CAPEX Breakdown */}
          {financials.total_capex_cr && financials.total_capex_cr !== '--' && (
            <div className="mt-3 bg-[#0A0A0A] border border-[#1A1A1A] p-3 rounded space-y-1.5">
              <div className="text-gray-500 text-[9px] uppercase tracking-wider mb-2">CAPEX Breakdown</div>
              {[
                { label: 'Equipment', val: financials.equipment_cost_cr, color: '#00FF41' },
                { label: 'Land', val: financials.land_cost_cr, color: '#FFD700' },
                { label: 'Grid Connect', val: financials.grid_cost_cr, color: '#FF9500' },
              ].map(item => {
                const total = parseFloat(financials.total_capex_cr) || 1;
                const pct = ((parseFloat(item.val) || 0) / total * 100);
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-[9px]">
                      <span className="text-gray-400">{item.label}</span>
                      <span className="text-white">₹{item.val || '0'} Cr ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-[#1A1A1A] rounded-full h-1 mt-0.5">
                      <div className="h-1 rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between text-[10px] border-t border-[#1A1A1A] pt-1.5 mt-1.5">
                <span className="text-gray-400">Total CAPEX</span>
                <span className="text-[#00FF41] font-bold">₹{financials.total_capex_cr} Cr</span>
              </div>
              {financials.annual_opex_cr && (
                <div className="flex justify-between text-[9px]">
                  <span className="text-gray-400">Annual OPEX</span>
                  <span className="text-yellow-400">₹{financials.annual_opex_cr} Cr/yr</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chart */}
        <div>
          <h3 className="text-gray-500 tracking-widest uppercase mb-3">Revenue Projection</h3>
          <div className="w-full" style={{ height: 128 }}>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" vertical={false} />
                <XAxis dataKey="year" stroke="#666" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#666" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#000', border: '1px solid #1A1A1A', borderRadius: '4px', fontFamily: 'monospace' }}
                  itemStyle={{ color: '#00FF41' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#00FF41" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Equipment */}
        <div>
          <h3 className="text-gray-500 tracking-widest uppercase mb-3">Equipment Configuration</h3>
          <div className="space-y-2">
            {isSolar && (
              <>
                <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
                  <span className="text-gray-400">Solar Panels (550Wp)</span>
                  <span className="text-white">{equipment.panels?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
                  <span className="text-gray-400">Inverters (500kW)</span>
                  <span className="text-white">{equipment.inverters}</span>
                </div>
              </>
            )}
            {isWind && (
              <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
                <span className="text-gray-400">Wind Turbines (2.0MW)</span>
                <span className="text-white">{equipment.turbines}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
              <span className="text-gray-400">Land Required</span>
              <span className="text-white">{equipment.land_acres} acres</span>
            </div>
            <div className="flex justify-between items-center pb-2">
              <span className="text-gray-400">Transformer</span>
              <span className="text-white">{equipment.transformer}</span>
            </div>
          </div>
        </div>

        {/* Risk Assessment */}
        <div>
          <h3 className="text-gray-500 tracking-widest uppercase mb-3 flex items-center gap-2">
            <ShieldAlert className="w-3 h-3" /> Risk Assessment
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
              <span className="text-gray-400">Land Acquisition</span>
              <span className={getRiskColor(risk_assessment?.land_acquisition)}>{risk_assessment?.land_acquisition}</span>
            </div>
            <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
              <span className="text-gray-400">Grid Curtailment</span>
              <span className={getRiskColor(risk_assessment?.grid_curtailment)}>{risk_assessment?.grid_curtailment}</span>
            </div>
            <div className="flex justify-between items-center border-b border-[#1A1A1A] pb-2">
              <span className="text-gray-400">Weather Risk</span>
              <span className={getRiskColor(risk_assessment?.weather_risk)}>{risk_assessment?.weather_risk}</span>
            </div>
            <div className="flex justify-between items-center pb-2">
              <span className="text-gray-400">Policy</span>
              <span className={getRiskColor(risk_assessment?.policy)}>{risk_assessment?.policy}</span>
            </div>
          </div>
        </div>

        {/* Impact */}
        <div>
          <h3 className="text-gray-500 tracking-widest uppercase mb-3">National Impact</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-gray-400 mb-1">CO₂ Avoided</div>
              <div className="text-white text-lg">{impact.co2_tonnes >= 1000 ? (impact.co2_tonnes / 1000).toFixed(1) + 'K' : impact.co2_tonnes}</div>
              <div className="text-gray-500">tonnes/year</div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Homes Powered</div>
              <div className="text-white text-lg">{impact.homes >= 1000 ? (impact.homes / 1000).toFixed(1) + 'K' : impact.homes}</div>
              <div className="text-gray-500">households</div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Jobs Created</div>
              <div className="text-white text-lg">{impact.jobs}</div>
              <div className="text-gray-500">direct + indirect</div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Trees Equiv.</div>
              <div className="text-white text-lg">{impact.trees >= 1000 ? (impact.trees / 1000).toFixed(0) + 'K' : impact.trees}</div>
              <div className="text-gray-500">trees/year</div>
            </div>
          </div>
        </div>

        {/* Transparency Block with Trust Indicators */}
        <div className="border border-[#1A1A1A] p-3 rounded bg-[#0A0A0A]">
          <h3 className="text-gray-500 tracking-widest uppercase mb-2 text-[10px] flex items-center gap-1">
            <Shield className="w-3 h-3" /> Data Transparency & Trust
          </h3>
          <div className="space-y-2 text-[10px]">
            {[
              { label: 'Solar Irradiance', status: transparency.nasa_power, source: 'NASA POWER API', conf: transparency.nasa_power === 'LIVE' ? 'HIGH' : 'LOW' },
              { label: 'Wind Speed', status: transparency.wind_atlas, source: 'NASA POWER API', conf: transparency.wind_atlas === 'LIVE' ? 'HIGH' : 'LOW' },
              { label: 'Land Rate', status: transparency.land_rate, source: '99acres + Gemini', conf: 'MEDIUM' },
              { label: 'Power Tariff', status: transparency.tariff, source: 'CERC FY2024-25', conf: 'HIGH' },
            ].map((item, i) => (
              <div key={i} className="flex justify-between items-center">
                <span className="text-gray-500">{item.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`${
                    item.status === 'LIVE' ? 'text-[#00FF41]' :
                    item.status === 'ESTIMATED' ? 'text-yellow-500' : 'text-gray-400'
                  }`}>{item.status}</span>
                  <span className={`text-[7px] px-1 rounded ${
                    item.conf === 'HIGH' ? 'bg-[#00FF41]/10 text-[#00FF41]' :
                    item.conf === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>{item.conf}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-[#1A1A1A] flex gap-2 mt-auto">
        <button className="flex-1 bg-transparent border border-[#1A1A1A] hover:border-gray-500 text-white py-2 rounded flex items-center justify-center transition-colors">
          <Bookmark className="w-4 h-4 mr-2" /> Save Site
        </button>
        <ReportExport data={data} location={selectedLocation} />
      </div>
    </div>
  );
}
