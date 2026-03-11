import React, { useState, useEffect, useRef } from 'react';
import Map from './components/Map';
import SidebarLeft from './components/SidebarLeft';
import SidebarRight from './components/SidebarRight';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import { Activity, Search, Map as MapIcon, RefreshCw } from 'lucide-react';
import axios from 'axios';

export default function App() {
  const [budget, setBudget] = useState(50000000);
  const [energyType, setEnergyType] = useState('solar');
  const [years, setYears] = useState(10);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number, lon: number } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hotspots, setHotspots] = useState<{ lat: number, lon: number, type: string, name: string }[]>([]);
  const [nearestProperties, setNearestProperties] = useState<any[]>([]);
  const [isFetchingProperties, setIsFetchingProperties] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);

  // New state for substations and heatmap
  const [substations, setSubstations] = useState<any[]>([]);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapVisible, setHeatmapVisible] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // AbortController for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const handleAnalyze = async (locationToAnalyze = selectedLocation, specificProperty?: any) => {
    if (!locationToAnalyze) return;

    // Cancel any previous request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    try {
      const payload: any = {
        lat: locationToAnalyze.lat,
        lon: locationToAnalyze.lon,
        budget,
        energyType,
        years
      };

      if (specificProperty) {
        // Parse area more robustly — extract numeric value and handle units
        let areaAcres = 1;
        const areaStr = String(specificProperty.area || '');
        const numVal = parseFloat(areaStr.replace(/[^\d.]/g, ''));
        if (numVal > 0) {
          if (areaStr.toLowerCase().includes('acre')) {
            areaAcres = numVal;
          } else if (areaStr.toLowerCase().includes('hectare') || areaStr.toLowerCase().includes('hect')) {
            areaAcres = numVal * 2.471;
          } else {
            // Assume sq.ft — convert to acres
            areaAcres = numVal / 43560;
          }
        }
        areaAcres = Math.max(0.5, areaAcres);

        payload.specificProperty = {
          price_inr: specificProperty.priceValue || 0,
          area_acres: areaAcres
        };
      }

      const response = await axios.post('/api/analyze/pinpoint', payload, {
        signal: controller.signal,
        timeout: 60000
      });
      setAnalysisResult(response.data);

      // Extract substations from response
      if (response.data.substations && response.data.substations.length > 0) {
        setSubstations(response.data.substations);
      } else {
        // Fetch substations separately as fallback
        try {
          const subRes = await axios.post('/api/substations', { lat: locationToAnalyze.lat, lon: locationToAnalyze.lon });
          if (subRes.data.success && subRes.data.substations.length > 0) {
            setSubstations(subRes.data.substations);
          }
        } catch { /* ignore substations fallback failure */ }
      }
    } catch (error: any) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
      console.error("Analysis failed:", error);
      // Still try to fetch substations even if analysis failed
      try {
        const subRes = await axios.post('/api/substations', { lat: locationToAnalyze.lat, lon: locationToAnalyze.lon });
        if (subRes.data.success) setSubstations(subRes.data.substations);
      } catch { /* ignore */ }
    } finally {
      setIsLoading(false);
    }
  };

  // DO NOT auto-analyze when params change — user must click "Analyze Site"
  // This prevents wasted API calls when adjusting budget/type/years

  const handleFindHeatmaps = async (targetState?: string) => {
    setIsLoading(true);
    try {
      // Fetch hotspots (circles) and heatmap data in parallel
      const [hotspotsResponse, heatmapResponse] = await Promise.all([
        axios.post('/api/heatmaps', { energyType }),
        axios.post('/api/heatmap-data', {
          state: targetState || analysisResult?.location_details?.state || '',
          energyType
        })
      ]);

      setHotspots(hotspotsResponse.data.hotspots || []);

      if (heatmapResponse.data.success && heatmapResponse.data.heatPoints.length > 0) {
        setHeatmapData(heatmapResponse.data.heatPoints);
        setHeatmapVisible(true);
      } else {
        // Even if filtered heatmap fails, show hotspots as heat data
        const fallbackHeat = (hotspotsResponse.data.hotspots || []).map((h: any) => ({
          lat: h.lat, lon: h.lon, intensity: 0.8, label: h.name, category: 'hotspot'
        }));
        if (fallbackHeat.length > 0) {
          setHeatmapData(fallbackHeat);
          setHeatmapVisible(true);
        }
      }

      setSelectedLocation(null);
      setAnalysisResult(null);
      setSubstations([]);
    } catch (error) {
      console.error("Failed to find heatmaps:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocationSelect = (lat: number, lon: number) => {
    const newLocation = { lat, lon };
    setSelectedLocation(newLocation);
    setNearestProperties([]);
    setBottomPanelOpen(false);
    setAnalysisResult(null);
    // Don't auto-analyze — user clicks "Analyze Site" button
  };

  const handleFetchNearestLands = async () => {
    if (!selectedLocation) return;
    setIsFetchingProperties(true);
    setBottomPanelOpen(true);
    try {
      // Try district first, then site name, then state
      const district = analysisResult?.location_details?.district?.replace(/ District$/i, '').replace(/ Mandal$/i, '') || '';
      const siteName = analysisResult?.location_details?.site_name || '';
      const state = analysisResult?.location_details?.state || '';
      const cityFilter = district && district !== 'Unknown' ? district : (siteName && siteName !== 'Unknown Site' ? siteName : 'bangalore');

      const response = await axios.post('/api/scrape/99acres', {
        city: cityFilter,
        propertyType: 'agricultural-land'
      }, { timeout: 30000 });

      if (response.data.success && response.data.properties && response.data.properties.length > 0) {
        setNearestProperties(response.data.properties);
      } else {
        // If main city failed, try state capital as fallback
        const stateCapitals: Record<string, string> = {
          'Rajasthan': 'jaipur', 'Gujarat': 'ahmedabad', 'Tamil Nadu': 'chennai',
          'Karnataka': 'bangalore', 'Andhra Pradesh': 'hyderabad', 'Telangana': 'hyderabad',
          'Maharashtra': 'pune', 'Madhya Pradesh': 'bhopal', 'Uttar Pradesh': 'lucknow',
          'Punjab': 'chandigarh', 'Haryana': 'gurugram', 'Kerala': 'kochi',
          'Odisha': 'bhubaneswar', 'West Bengal': 'kolkata', 'Bihar': 'patna'
        };
        const fallbackCity = stateCapitals[state] || 'bangalore';
        const fallbackRes = await axios.post('/api/scrape/99acres', {
          city: fallbackCity,
          propertyType: 'agricultural-land'
        }, { timeout: 30000 });

        if (fallbackRes.data.success && fallbackRes.data.properties?.length > 0) {
          setNearestProperties(fallbackRes.data.properties);
        } else {
          setNearestProperties([]);
        }
      }
    } catch (error) {
      console.error(error);
      setNearestProperties([]);
    } finally {
      setIsFetchingProperties(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden font-mono">
      {/* Top Navigation */}
      <header className="h-12 bg-black border-b border-[#1A1A1A] flex items-center justify-between px-4 shrink-0 z-10 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#00FF41]" />
            <h1 className="font-bold tracking-widest text-white">
              GreenGrid <span className="text-[#00FF41] font-normal">INTELLIGENCE</span>
            </h1>
          </div>
          <div className="h-4 w-px bg-[#1A1A1A]"></div>
          <div className="text-gray-500 tracking-widest uppercase">INDIA · REAL-TIME DATA</div>
        </div>

        <div className="flex items-center gap-4 text-gray-400">
          {selectedLocation && (
            <>
              <div>SITE: <span className="text-[#00FF41]">{analysisResult?.location_details?.site_name || 'Selected Location'}</span></div>
              <div>{selectedLocation.lat.toFixed(4)}°N, {selectedLocation.lon.toFixed(4)}°E</div>
              <div>SCORE: <span className="text-[#00FF41]">{analysisResult?.energy?.score || '--'}</span></div>
            </>
          )}

          {/* Substations count indicator */}
          {substations.length > 0 && (
            <div className="text-[#FFC800]">
              ⚡ {substations.length} substations
            </div>
          )}

          <div className="flex items-center gap-1 text-[#00FF41]">
            <div className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse"></div>
            LIVE
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        <SidebarLeft
          budget={budget} setBudget={setBudget}
          energyType={energyType} setEnergyType={setEnergyType}
          years={years} setYears={setYears}
          onAnalyze={() => handleAnalyze()}
          onFindHeatmaps={handleFindHeatmaps}
          isLoading={isLoading}
          selectedLocation={selectedLocation}
          onLocationSelect={handleLocationSelect}
          heatmapVisible={heatmapVisible}
          onToggleHeatmap={() => setHeatmapVisible(!heatmapVisible)}
        />

        <main className="flex-1 relative bg-[#050505]">
          <Map
            onLocationSelect={handleLocationSelect}
            selectedLocation={selectedLocation}
            hotspots={hotspots}
            substations={substations}
            heatmapData={heatmapData}
            heatmapVisible={heatmapVisible}
          />

          {/* Fetch Land Rates Button */}
          {selectedLocation && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
              <button
                onClick={handleFetchNearestLands}
                disabled={isFetchingProperties}
                className="bg-[#00FF41]/10 border border-[#00FF41] hover:bg-[#00FF41]/20 text-[#00FF41] font-bold py-2 px-6 rounded-full shadow-[0_0_15px_rgba(0,255,65,0.3)] transition-all flex items-center gap-2"
              >
                {isFetchingProperties ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-[#00FF41] border-t-transparent animate-spin"></div>
                    Fetching Regional Land Details...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Fetch Accurate Land Rates
                  </>
                )}
              </button>
            </div>
          )}

          {/* Bottom Property Gallery Panel */}
          <div className={`absolute bottom-8 left-0 right-0 z-[1000] transition-transform duration-500 ${bottomPanelOpen ? 'translate-y-0' : 'translate-y-[150%]'}`}>
            <div className="mx-4 bg-black/90 backdrop-blur-md border border-[#1A1A1A] rounded-lg shadow-2xl p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-[#00FF41] font-bold text-xs flex items-center gap-2">
                  <MapIcon className="w-4 h-4" /> REAL MARKET LISTINGS IN VICINITY
                </h3>
                <button onClick={() => setBottomPanelOpen(false)} className="text-gray-500 hover:text-white text-xs">Close</button>
              </div>

              {isFetchingProperties ? (
                <div className="flex justify-center items-center h-40 text-gray-500 gap-3">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#00FF41]" /> Scanning 99acres for regional land rates...
                </div>
              ) : nearestProperties.length > 0 ? (
                <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
                  {nearestProperties.map((prop, idx) => (
                    <div key={idx} className="min-w-[280px] max-w-[280px] bg-[#050505] border border-[#1A1A1A] rounded snap-start overflow-hidden flex flex-col hover:border-[#00FF41]/50 transition-colors">
                      <div className="h-32 bg-gray-900 relative">
                        {prop.image && prop.image !== 'https://via.placeholder.com/150?text=No+Image' && prop.image !== 'https://via.placeholder.com/150?text=AI+Estimate' ? (
                          <img src={prop.image} className="w-full h-full object-cover opacity-80" alt={prop.title} />
                        ) : (
                          <div className="flex items-center justify-center h-full w-full text-gray-700 text-xs">
                            {prop.isEstimated ? 'AI Estimated Listing' : 'No Image Available'}
                          </div>
                        )}
                        <div className="absolute top-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-bold text-[#00FF41] backdrop-blur">
                          {prop.price}
                        </div>
                        {prop.isEstimated && (
                          <div className="absolute top-2 left-2 bg-yellow-500/20 border border-yellow-500/50 px-2 py-0.5 rounded text-[9px] text-yellow-400 backdrop-blur">
                            AI ESTIMATE
                          </div>
                        )}
                      </div>
                      <div className="p-3 flex-1 flex flex-col">
                        <div className="text-xs text-white line-clamp-2 mb-2 font-medium" title={prop.title}>{prop.title}</div>
                        <div className="text-[10px] text-gray-400 mb-2 flex justify-between">
                          <span>Area: <span className="text-gray-200">{prop.area}</span></span>
                          <span>Age: <span className="text-gray-200">{prop.yearsBuilt} yrs</span></span>
                        </div>
                        <div className="text-[9px] text-gray-500 mb-4 truncate" title={prop.agentDetails}>Agent: {prop.agentDetails}</div>

                        <div className="mt-auto">
                          <button
                            onClick={() => handleAnalyze(selectedLocation, prop)}
                            className="w-full bg-[#00FF41]/10 hover:bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/30 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                          >
                            Deploy Financials Here
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col justify-center items-center h-24 text-gray-500 text-xs gap-2">
                  <div>No live listings found for this area.</div>
                  <div className="text-[10px] text-gray-600">Land rate estimates are shown in the right panel. Try "Live 99Acres Data" button there for more options.</div>
                </div>
              )}
            </div>
          </div>

          {/* Status Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur border-t border-[#1A1A1A] px-4 py-1.5 text-[10px] text-gray-500 flex justify-between items-center z-[1000]">
            <div className="flex gap-6">
              <div className="flex items-center gap-1 text-[#00FF41]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#00FF41]"></div>
                LIVE
              </div>
              <div>MODE: <span className="text-[#00FF41]">STANDARD</span></div>
              {selectedLocation && (
                <>
                  <div>LAT: <span className="text-white">{selectedLocation.lat.toFixed(4)}</span></div>
                  <div>LON: <span className="text-white">{selectedLocation.lon.toFixed(4)}</span></div>
                  <div>SCORE: <span className="text-[#00FF41]">{analysisResult?.energy?.score || '--'}</span></div>
                </>
              )}
              {substations.length > 0 && (
                <div>GRID: <span className="text-[#FFC800]">{substations.length} nodes</span></div>
              )}
            </div>
            <div className="text-[#00FF41]">GREENGRID INTELLIGENCE v3.0 · REAL-TIME</div>
          </div>
        </main>

        <SidebarRight
          result={analysisResult}
          selectedLocation={selectedLocation}
          onReanalyze={() => handleAnalyze()}
          isLoading={isLoading}
          onOpenDashboard={() => setShowDashboard(true)}
        />
      </div>

      {/* Analytics Dashboard Overlay */}
      {showDashboard && analysisResult && (
        <AnalyticsDashboard
          financials={analysisResult.financials}
          energy={analysisResult.energy}
          revenueProjection={analysisResult.revenue_projection || []}
          years={years}
          onClose={() => setShowDashboard(false)}
        />
      )}
    </div>
  );
}
