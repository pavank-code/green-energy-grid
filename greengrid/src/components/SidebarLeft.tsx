import React, { useState, useEffect } from 'react';
import { Sun, Wind, Zap, Search, Crosshair, Activity, Eye, EyeOff, Droplets, Leaf, Wheat } from 'lucide-react';

interface SidebarLeftProps {
  budget: number;
  setBudget: (val: number) => void;
  energyType: string;
  setEnergyType: (val: string) => void;
  years: number;
  setYears: (val: number) => void;
  onAnalyze: () => void;
  onFindHeatmaps: (state?: string) => void;
  isLoading: boolean;
  selectedLocation: { lat: number, lon: number } | null;
  onLocationSelect: (lat: number, lon: number) => void;
  heatmapVisible: boolean;
  onToggleHeatmap: () => void;
}

const INDIAN_STATES = [
  '', 'Rajasthan', 'Gujarat', 'Tamil Nadu', 'Karnataka', 'Andhra Pradesh',
  'Telangana', 'Maharashtra', 'Madhya Pradesh', 'Uttar Pradesh', 'Punjab',
  'Haryana', 'Kerala', 'Odisha', 'West Bengal', 'Bihar', 'Jharkhand',
  'Uttarakhand', 'Himachal Pradesh', 'Jammu & Kashmir', 'Goa'
];

// Logarithmic slider helpers — maps 0-100 to ₹1L-₹100Cr
const BUDGET_MIN_LOG = Math.log(100000);      // ₹1 Lakh
const BUDGET_MAX_LOG = Math.log(1000000000);   // ₹100 Crore
function budgetToSlider(budget: number): number {
  const clamped = Math.max(100000, Math.min(1000000000, budget));
  return ((Math.log(clamped) - BUDGET_MIN_LOG) / (BUDGET_MAX_LOG - BUDGET_MIN_LOG)) * 100;
}
function sliderToBudget(slider: number): number {
  return Math.round(Math.exp(BUDGET_MIN_LOG + (slider / 100) * (BUDGET_MAX_LOG - BUDGET_MIN_LOG)));
}

function formatBudget(val: number): string {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(val >= 100000000 ? 0 : 1)} Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(val >= 1000000 ? 0 : 1)} L`;
  return `₹${val.toLocaleString('en-IN')}`;
}

const ENERGY_TYPES = [
  { id: 'solar', label: 'Solar', icon: Sun, color: '#FFD700' },
  { id: 'wind', label: 'Wind', icon: Wind, color: '#00BFFF' },
  { id: 'hybrid', label: 'Hybrid', icon: Zap, color: '#00FF41' },
  { id: 'small_hydro', label: 'Hydro', icon: Droplets, color: '#4FC3F7' },
  { id: 'biogas', label: 'Biogas', icon: Leaf, color: '#66BB6A' },
  { id: 'biomass', label: 'Biomass', icon: Wheat, color: '#A1887F' },
];

export default function SidebarLeft({
  budget, setBudget, energyType, setEnergyType, years, setYears, onAnalyze, onFindHeatmaps, isLoading, selectedLocation, onLocationSelect, heatmapVisible, onToggleHeatmap
}: SidebarLeftProps) {
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [targetState, setTargetState] = useState('');

  useEffect(() => {
    if (selectedLocation) {
      setLatInput(selectedLocation.lat.toFixed(6));
      setLonInput(selectedLocation.lon.toFixed(6));
    } else {
      setLatInput('');
      setLonInput('');
    }
  }, [selectedLocation]);

  const handleApplyCoordinates = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onLocationSelect(lat, lon);
    }
  };

  return (
    <div className="w-72 bg-black border-r border-[#1A1A1A] flex flex-col h-full text-gray-300 overflow-y-auto font-mono text-xs">
      <div className="p-4 border-b border-[#1A1A1A] flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#00FF41]"></div>
        <h2 className="text-[#00FF41] font-semibold tracking-widest uppercase">Investment Console</h2>
      </div>

      <div className="p-4 space-y-8 flex-1">
        {/* Budget */}
        <div className="space-y-3">
          <label className="text-gray-500 tracking-widest uppercase block">Investment Budget</label>
          <div className="text-center text-[#00FF41] font-bold text-lg mb-1">{formatBudget(budget)}</div>
          <input
            type="range"
            min={0} max={100} step={0.5}
            value={budgetToSlider(budget)}
            onChange={(e) => setBudget(sliderToBudget(parseFloat(e.target.value)))}
            className="w-full accent-[#00FF41] custom-range"
          />
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>₹1 L</span><span>₹10 L</span><span>₹1 Cr</span><span>₹10 Cr</span><span>₹100 Cr</span>
          </div>
          <div className="grid grid-cols-4 gap-1 mt-2">
            {[500000, 1000000, 5000000, 10000000, 50000000, 100000000, 500000000, 1000000000].map(val => (
              <button
                key={val}
                onClick={() => setBudget(val)}
                className={`py-1.5 rounded border text-[9px] transition-colors ${
                  Math.abs(budget - val) < val * 0.05
                    ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]' 
                    : 'bg-[#0A0A0A] border-[#1A1A1A] text-gray-500 hover:border-gray-700'
                }`}
              >
                {formatBudget(val)}
              </button>
            ))}
          </div>
        </div>

        {/* Energy Type */}
        <div className="space-y-3">
          <label className="text-gray-500 tracking-widest uppercase block">Energy Type</label>
          <div className="grid grid-cols-3 gap-2">
            {ENERGY_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => setEnergyType(type.id)}
                className={`flex flex-col items-center justify-center py-2.5 rounded border transition-all ${
                  energyType === type.id 
                    ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]' 
                    : 'bg-[#0A0A0A] border-[#1A1A1A] text-gray-400 hover:border-gray-700'
                }`}
              >
                <type.icon className="w-4 h-4 mb-1" style={energyType === type.id ? { color: type.color } : {}} />
                <span className="text-[10px]">{type.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Time Horizon */}
        <div className="space-y-3">
          <label className="text-gray-500 tracking-widest uppercase block">Time Horizon</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1} max={30} step={1}
              value={years}
              onChange={(e) => setYears(parseInt(e.target.value))}
              className="flex-1 accent-[#00FF41] custom-range"
            />
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] rounded px-2 py-1 min-w-[48px] text-center">
              <input
                type="number"
                min={1} max={30}
                value={years}
                onChange={(e) => { const v = parseInt(e.target.value); if (v >= 1 && v <= 30) setYears(v); }}
                className="bg-transparent w-8 outline-none text-[#00FF41] text-center font-bold"
              />
              <span className="text-gray-500 text-[9px]">yr</span>
            </div>
          </div>
          <div className="flex gap-1">
            {[5, 10, 15, 20, 25].map(y => (
              <button
                key={y}
                onClick={() => setYears(y)}
                className={`flex-1 py-1.5 rounded border transition-colors text-[10px] ${
                  years === y 
                    ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]' 
                    : 'bg-[#0A0A0A] border-[#1A1A1A] text-gray-500 hover:border-gray-700'
                }`}
              >
                {y}y
              </button>
            ))}
          </div>
        </div>

        {/* Coordinates */}
        <div className="space-y-4 mt-8 pt-6 border-t border-[#1A1A1A]">
          <label className="text-gray-500 tracking-widest uppercase block flex items-center gap-2">
            <Crosshair className="w-3 h-3" /> Manual Target
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] rounded px-3 py-2">
              <input 
                type="text" 
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                className="bg-transparent w-full outline-none text-white placeholder-gray-700 text-xs"
                placeholder="Latitude"
              />
            </div>
            <div className="bg-[#0A0A0A] border border-[#1A1A1A] rounded px-3 py-2">
              <input 
                type="text" 
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                className="bg-transparent w-full outline-none text-white placeholder-gray-700 text-xs"
                placeholder="Longitude"
              />
            </div>
          </div>
          <button 
            onClick={handleApplyCoordinates}
            className="w-full bg-[#0A0A0A] border border-[#1A1A1A] text-gray-400 hover:text-[#00FF41] hover:border-[#00FF41] py-2 rounded transition-colors uppercase tracking-wider text-xs font-bold"
          >
            Apply Coordinates
          </button>
        </div>

        {/* Heatmap Controls */}
        <div className="space-y-4 pt-6 border-t border-[#1A1A1A]">
          <label className="text-gray-500 tracking-widest uppercase block flex items-center gap-2">
            <Search className="w-3 h-3" /> Heatmap Intelligence
          </label>
          <select
            value={targetState}
            onChange={(e) => setTargetState(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#1A1A1A] text-gray-300 rounded px-3 py-2 outline-none text-xs focus:border-[#00FF41] transition-colors"
          >
            <option value="">All India</option>
            {INDIAN_STATES.filter(s => s).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            onClick={() => onToggleHeatmap()}
            className={`w-full py-2 px-3 rounded border flex items-center justify-center gap-2 transition-all text-xs ${
              heatmapVisible
                ? 'bg-[#FF6600]/10 border-[#FF6600] text-[#FF6600]'
                : 'bg-[#0A0A0A] border-[#1A1A1A] text-gray-400 hover:border-gray-600'
            }`}
          >
            {heatmapVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {heatmapVisible ? 'HIDE HEATMAP' : 'SHOW HEATMAP'}
          </button>
        </div>
      </div>

      <div className="p-4 border-t border-[#1A1A1A] space-y-3">
        {isLoading && (
          <div className="w-full bg-[#00FF41]/20 text-[#00FF41] font-bold py-3 rounded flex justify-center items-center gap-2 uppercase tracking-wider">
            <span className="animate-pulse">Analyzing...</span>
          </div>
        )}
          <div className="space-y-3">
            <button
              onClick={onAnalyze}
              disabled={isLoading || !selectedLocation}
              className={`w-full py-3 px-4 flex items-center justify-center gap-2 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed
                ${!selectedLocation 
                  ? 'bg-gray-800 text-gray-500 border border-gray-700' 
                  : 'bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41] hover:bg-[#00FF41]/20 shadow-[0_0_15px_rgba(0,255,65,0.2)]'
                }`}
            >
              <Activity className={`w-4 h-4 ${isLoading ? 'animate-pulse' : ''}`} />
              {isLoading ? 'ANALYZING...' : 'ANALYZE SITE'}
            </button>

            <button
              onClick={() => onFindHeatmaps(targetState)}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-black border border-[#1A1A1A] hover:bg-[#050505] text-gray-300 flex items-center justify-center gap-2 transition-all hover:border-[#00FF41]/30 group"
            >
              <Search className="w-4 h-4 group-hover:text-[#00FF41]" />
              FIND HEATMAPS
            </button>
          </div>
        <div className="flex items-center justify-center gap-2 text-gray-500 pt-2">
          <div className="w-3 h-3 rounded-full border border-gray-500 flex items-center justify-center text-[8px]">⌖</div>
          Click anywhere on map for live analysis
        </div>
      </div>
    </div>
  );
}
