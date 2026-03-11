import React from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, ReferenceLine
} from 'recharts';

interface AnalyticsDashboardProps {
  financials: any;
  energy: any;
  revenueProjection: any[];
  years: number;
  onClose: () => void;
}

export default function AnalyticsDashboard({ financials, energy, revenueProjection, years, onClose }: AnalyticsDashboardProps) {
  const annualRev = parseFloat(financials?.annual_revenue_cr || '0');
  const annualOpex = parseFloat(financials?.annual_opex_cr || '0');
  const totalCapex = parseFloat(financials?.total_capex_cr || financials?.budget_cr || '0');
  const annualGen = parseFloat(energy?.annual_mwh || '0');

  // 1. Revenue vs Time (with OPEX overlay)
  const projYears = Math.max(years, 10);
  const revenueData = Array.from({ length: projYears }, (_, i) => {
    const escalatedRev = annualRev * Math.pow(1.03, i);
    const escalatedOpex = annualOpex * Math.pow(1.02, i); // 2% OPEX escalation
    return {
      year: i + 1,
      revenue: parseFloat(escalatedRev.toFixed(2)),
      opex: parseFloat(escalatedOpex.toFixed(2)),
      netProfit: parseFloat((escalatedRev - escalatedOpex).toFixed(2)),
    };
  });

  // 2. Cumulative Cash Flow (Payback Curve)
  const paybackData = Array.from({ length: projYears }, (_, i) => {
    let cumCashflow = -totalCapex;
    for (let j = 0; j <= i; j++) {
      cumCashflow += revenueData[j].netProfit;
    }
    return {
      year: i + 1,
      cumulative: parseFloat(cumCashflow.toFixed(2)),
    };
  });

  // 3. Energy Output vs Time (degradation model)
  const energyData = Array.from({ length: projYears }, (_, i) => {
    const solarDegradation = Math.pow(0.995, i); // 0.5% annual degradation
    const gen = annualGen * solarDegradation;
    return {
      year: i + 1,
      generation: Math.round(gen),
      generationGWh: parseFloat((gen / 1000).toFixed(2)),
    };
  });

  // 4. Monthly Energy Profile (if monthly data available)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyProfile = months.map((m, i) => {
    // Approximate seasonal variation for India
    const solarFactor = [0.85, 0.90, 0.95, 1.05, 1.10, 0.80, 0.70, 0.75, 0.85, 0.95, 0.90, 0.85][i];
    const windFactor = [0.60, 0.65, 0.75, 0.80, 0.90, 1.30, 1.40, 1.20, 1.00, 0.80, 0.60, 0.55][i];
    const isSolar = energy?.type === 'solar' || energy?.type === 'hybrid';
    const isWind = energy?.type === 'wind' || energy?.type === 'hybrid';
    return {
      month: m,
      solar: isSolar ? Math.round((annualGen / 12) * solarFactor) : 0,
      wind: isWind ? Math.round((annualGen / 12) * windFactor * 0.4) : 0,
    };
  });

  // 5. Carbon offset projection
  const carbonData = Array.from({ length: projYears }, (_, i) => {
    const cumCO2 = energyData.slice(0, i + 1).reduce((acc, e) => acc + e.generation * 0.716 / 1000, 0);
    return {
      year: i + 1,
      annual: parseFloat((energyData[i].generation * 0.716 / 1000).toFixed(1)),
      cumulative: parseFloat(cumCO2.toFixed(1)),
    };
  });

  const tooltipStyle = {
    backgroundColor: '#0A0A0A',
    border: '1px solid #1A1A1A',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '10px',
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/95 backdrop-blur-md flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A1A1A]">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse" />
          <h2 className="text-[#00FF41] font-bold tracking-widest uppercase text-sm">Revenue Analytics Dashboard</h2>
          <span className="text-gray-500 text-xs">|</span>
          <span className="text-gray-400 text-xs">{projYears}-Year Projection</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white border border-[#1A1A1A] hover:border-gray-600 px-4 py-1.5 rounded text-xs transition-colors"
        >
          CLOSE DASHBOARD
        </button>
      </div>

      {/* Summary Cards */}
      <div className="px-6 py-3 flex gap-4 border-b border-[#1A1A1A]">
        {[
          { label: 'Total CAPEX', value: `₹${totalCapex.toFixed(1)} Cr`, color: '#FF6666' },
          { label: 'Annual Revenue', value: `₹${annualRev.toFixed(2)} Cr`, color: '#00FF41' },
          { label: 'IRR', value: `${financials?.irr_percent || '--'}%`, color: '#00BFFF' },
          { label: 'Payback', value: `${financials?.payback_years || '--'} yrs`, color: '#FFD700' },
          { label: 'Annual Gen', value: `${annualGen >= 1000 ? (annualGen / 1000).toFixed(1) + ' GWh' : annualGen + ' MWh'}`, color: '#00FF41' },
          { label: 'LCOE', value: `₹${financials?.lcoe || '--'}/kWh`, color: '#FF9500' },
        ].map((card, i) => (
          <div key={i} className="flex-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded px-3 py-2">
            <div className="text-gray-500 text-[9px] uppercase tracking-wider">{card.label}</div>
            <div className="font-bold text-sm" style={{ color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="flex-1 p-6 grid grid-cols-2 grid-rows-3 gap-4 overflow-auto">
        {/* Chart 1: Revenue vs Time */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Revenue vs Operating Costs</h3>
          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="year" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis stroke="#666" fontSize={9} tickLine={false} unit=" Cr" />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Area type="monotone" dataKey="revenue" fill="#00FF41" fillOpacity={0.1} stroke="#00FF41" strokeWidth={2} name="Revenue (₹Cr)" />
              <Line type="monotone" dataKey="opex" stroke="#FF6666" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="OPEX (₹Cr)" />
              <Bar dataKey="netProfit" fill="#00FF41" fillOpacity={0.3} name="Net Profit (₹Cr)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: Payback Curve */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Cumulative Cash Flow (Payback Curve)</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={paybackData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="year" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis stroke="#666" fontSize={9} tickLine={false} unit=" Cr" />
              <Tooltip contentStyle={tooltipStyle} />
              <ReferenceLine y={0} stroke="#FFD700" strokeWidth={1.5} strokeDasharray="5 5" label={{ value: 'Breakeven', fill: '#FFD700', fontSize: 9 }} />
              <defs>
                <linearGradient id="paybackGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00FF41" stopOpacity={0.4} />
                  <stop offset="50%" stopColor="#00FF41" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#FF6666" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="cumulative" fill="url(#paybackGrad)" stroke="#00BFFF" strokeWidth={2} name="Cumulative (₹Cr)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 3: Energy Output vs Time */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Energy Output Over Time (with degradation)</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={energyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="year" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis stroke="#666" fontSize={9} tickLine={false} unit=" MWh" />
              <Tooltip contentStyle={tooltipStyle} />
              <defs>
                <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00BFFF" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00BFFF" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="generation" fill="url(#energyGrad)" stroke="#00BFFF" strokeWidth={2} name="Annual MWh" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 4: Monthly Energy Profile */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Monthly Energy Profile (Estimated)</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={monthlyProfile}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="month" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis stroke="#666" fontSize={9} tickLine={false} unit=" MWh" />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Bar dataKey="solar" fill="#FFD700" fillOpacity={0.7} name="Solar" stackId="energy" />
              <Bar dataKey="wind" fill="#00BFFF" fillOpacity={0.7} name="Wind" stackId="energy" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 5: Profit Projection */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Net Profit Projection</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="year" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis stroke="#666" fontSize={9} tickLine={false} unit=" Cr" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="netProfit" name="Net Profit (₹Cr)">
                {revenueData.map((entry, index) => (
                  <rect key={index} fill={entry.netProfit >= 0 ? '#00FF41' : '#FF6666'} fillOpacity={0.6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 6: Carbon Offset Impact */}
        <div className="bg-[#050505] border border-[#1A1A1A] rounded-lg p-4">
          <h3 className="text-gray-400 text-[10px] uppercase tracking-wider mb-3">Carbon Offset Impact</h3>
          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart data={carbonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
              <XAxis dataKey="year" stroke="#666" fontSize={9} tickLine={false} />
              <YAxis yAxisId="left" stroke="#666" fontSize={9} tickLine={false} unit=" KT" />
              <YAxis yAxisId="right" orientation="right" stroke="#666" fontSize={9} tickLine={false} unit=" KT" />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Bar yAxisId="left" dataKey="annual" fill="#22C55E" fillOpacity={0.5} name="Annual CO₂ (KT)" />
              <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#00FF41" strokeWidth={2} dot={false} name="Cumulative CO₂ (KT)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t border-[#1A1A1A] flex justify-between text-[9px] text-gray-500">
        <span>Projections assume 3% annual tariff escalation, 0.5% panel degradation, 2% OPEX inflation. CO₂ factor: 0.716 kg/kWh (CEA 2023).</span>
        <span className="text-[#00FF41]">GREENGRID INTELLIGENCE — ANALYTICS ENGINE v3.0</span>
      </div>
    </div>
  );
}
