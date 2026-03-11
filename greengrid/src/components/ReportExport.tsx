import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ReportExportProps {
  data: any;
  location: { lat: number; lon: number } | null;
}

export default function ReportExport({ data, location }: ReportExportProps) {
  const [isExporting, setIsExporting] = useState(false);

  const generatePDF = async () => {
    setIsExporting(true);
    try {
      // 1. Create a temporary container for the report
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '800px';
      container.style.backgroundColor = '#000000';
      container.style.color = '#FFFFFF';
      container.style.padding = '40px';
      container.style.fontFamily = 'monospace';
      document.body.appendChild(container);

      // 2. Build the HTML content
      const { 
        location_details, energy, financials, equipment, 
        impact, risk_assessment, transparency 
      } = data;

      const title = location_details?.site_name || 'Site Analysis Report';
      const coords = location ? `${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E` : 'N/A';
      
      const isSolar = energy?.type === 'solar' || energy?.type === 'hybrid';
      const isWind = energy?.type === 'wind' || energy?.type === 'hybrid';

      const scores_detail = data.scores_detail || {};

      let htmlContent = `
        <div style="border: 1px solid #00FF41; padding: 20px; border-radius: 8px;">
          <h1 style="color: #00FF41; margin-bottom: 5px; font-size: 24px;">GREENGRID INTELLIGENCE</h1>
          <h2 style="font-size: 18px; color: #FFF; margin-bottom: 2px;">${title}</h2>
          <p style="color: #888; margin-top: 0;">${location_details?.district || 'Unknown'}, ${location_details?.state || 'Unknown'} | Coordinates: ${coords}</p>
          
          <hr style="border-color: #333; margin: 20px 0;" />
          
          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">SITE SCORES</h3>
              <p>Composite: <strong>${energy?.score} / 100</strong></p>
              <p>Solar Score: ${scores_detail.solar?.value ?? energy?.solar_score ?? '--'} (${scores_detail.solar?.confidence || 'N/A'})</p>
              <p>Wind Score: ${scores_detail.wind?.value ?? energy?.wind_score ?? '--'} (${scores_detail.wind?.confidence || 'N/A'})</p>
              <p>Weather: ${scores_detail.weather?.value ?? energy?.weather_score ?? '--'}</p>
              <p>Land: ${scores_detail.land?.value ?? energy?.land_score ?? '--'}</p>
              <p>Grid Access: ${scores_detail.grid?.value ?? energy?.grid_score ?? '--'}</p>
              <p>Recommendation: ${energy?.recommendation || 'N/A'}</p>
            </div>
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">ENERGY METRICS</h3>
              <p>Type: <strong>${energy?.type?.toUpperCase()}</strong></p>
              <p>Capacity: ${energy?.capacity_mw} MW</p>
              <p>Annual Gen: ${energy?.annual_mwh} MWh</p>
              ${isSolar ? `<p>GHI: ${energy?.ghi} kWh/m²/day</p>` : ''}
              ${isWind ? `<p>Wind (100m): ${energy?.wind_100m} m/s</p>` : ''}
              <p>Elevation: ${energy?.elevation}m</p>
              <p>Grid Distance: ${energy?.grid_distance_km}km</p>
            </div>
          </div>

          <hr style="border-color: #333; margin: 20px 0;" />

          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">FINANCIAL PROJECTIONS</h3>
              <p>Total CAPEX: ₹${financials?.total_capex_cr || financials?.budget_cr} Cr</p>
              <p>Annual Revenue: ₹${financials?.annual_revenue_cr} Cr</p>
              <p>Annual OPEX: ₹${financials?.annual_opex_cr || '--'} Cr</p>
              <p>IRR: ${financials?.irr_percent}%</p>
              <p>Payback Period: ${financials?.payback_years} years</p>
              <p>LCOE: ₹${financials?.lcoe}/kWh</p>
              <p>NPV: ₹${financials?.npv_cr} Cr</p>
            </div>
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">EQUIPMENT</h3>
              ${isSolar ? `<p>Solar Panels: ${equipment?.panels?.toLocaleString()}</p>
                          <p>Inverters: ${equipment?.inverters}</p>` : ''}
              ${isWind ? `<p>Wind Turbines: ${equipment?.turbines}</p>` : ''}
              <p>Land Required: ${equipment?.land_acres} acres</p>
              <p>Transformer: ${equipment?.transformer}</p>
            </div>
          </div>

          <hr style="border-color: #333; margin: 20px 0;" />

          <div style="display: flex; justify-content: space-between;">
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">IMPACT</h3>
              <p>CO2 Avoided: ${impact?.co2_tonnes} tonnes/yr</p>
              <p>Homes Powered: ${impact?.homes}</p>
              <p>Jobs Created: ${impact?.jobs}</p>
              <p>Trees Equivalent: ${impact?.trees} trees/yr</p>
            </div>
            <div style="width: 48%;">
              <h3 style="color: #00FF41; font-size: 16px;">DATA SOURCES</h3>
              <p style="font-size: 12px; color: #AAA;">Solar: ${transparency?.nasa_power}</p>
              <p style="font-size: 12px; color: #AAA;">Wind: ${transparency?.wind_atlas}</p>
              <p style="font-size: 12px; color: #AAA;">Land: ${transparency?.land_rate}</p>
              <p style="font-size: 12px; color: #AAA;">Tariff: ${transparency?.tariff}</p>
            </div>
          </div>
          
          <div style="margin-top: 30px; text-align: center; color: #555; font-size: 10px;">
            Generated by GreenGrid Intelligence on ${new Date().toLocaleDateString()} · Data sources: NASA POWER, OpenStreetMap, CERC, 99acres
          </div>
        </div>
      `;

      container.innerHTML = htmlContent;

      // 3. Render HTML to canvas
      const canvas = await html2canvas(container, {
        scale: 2, // Higher quality
        backgroundColor: '#000000',
        logging: false,
      });

      // 4. Create PDF and save
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`GreenGrid_Analysis_${title.replace(/\s+/g, '_')}.pdf`);

      // 5. Cleanup
      document.body.removeChild(container);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF report.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button 
      onClick={generatePDF}
      disabled={isExporting}
      className="flex-1 bg-transparent border border-[#1A1A1A] hover:border-gray-500 text-white py-2 rounded flex items-center justify-center transition-colors disabled:opacity-50"
    >
      {isExporting ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {isExporting ? 'Generating...' : 'Export PDF'}
    </button>
  );
}
