import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;

// Custom site marker (green pulse)
const customIcon = new L.DivIcon({
  className: 'custom-marker',
  html: `<div style="width: 24px; height: 24px; background-color: rgba(0, 255, 65, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #00FF41; box-shadow: 0 0 10px rgba(0, 255, 65, 0.5);">
          <div style="width: 8px; height: 8px; background-color: #00FF41; border-radius: 50%;"></div>
         </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Substation marker (yellow bolt)
const substationIcon = new L.DivIcon({
  className: 'substation-marker',
  html: `<div style="width: 20px; height: 20px; background: rgba(255, 200, 0, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #FFC800; box-shadow: 0 0 6px rgba(255, 200, 0, 0.4);">
          <span style="font-size: 10px;">⚡</span>
         </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

interface Substation {
  lat: number;
  lon: number;
  name: string;
  type: string;
  voltage: string;
  distance_km: number;
}

interface HeatPoint {
  lat: number;
  lon: number;
  intensity: number;
  category: string;
  label: string;
}

interface MapProps {
  onLocationSelect: (lat: number, lon: number) => void;
  selectedLocation: { lat: number; lon: number } | null;
  hotspots: { lat: number; lon: number; type: string; name: string }[];
  substations: Substation[];
  heatmapData: HeatPoint[];
  heatmapVisible: boolean;
}

function LocationMarker({ onLocationSelect, selectedLocation }: { onLocationSelect: (lat: number, lon: number) => void, selectedLocation: { lat: number; lon: number } | null }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return selectedLocation === null ? null : (
    <Marker position={[selectedLocation.lat, selectedLocation.lon]} icon={customIcon} />
  );
}

function MapUpdater({ selectedLocation, hotspots }: { selectedLocation: any, hotspots: any[] }) {
  const map = useMap();
  useEffect(() => {
    if (hotspots.length > 0 && !selectedLocation) {
      const bounds = L.latLngBounds(hotspots.map(h => [h.lat, h.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (selectedLocation) {
      map.setView([selectedLocation.lat, selectedLocation.lon], 8);
    }
  }, [hotspots, selectedLocation, map]);
  return null;
}

// Heatmap layer component using leaflet.heat
function HeatmapLayer({ data, visible }: { data: HeatPoint[]; visible: boolean }) {
  const map = useMap();
  const heatLayerRef = useRef<any>(null);

  useEffect(() => {
    // Dynamically import leaflet.heat
    import('leaflet.heat').then(() => {
      // Remove old layer
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      if (!visible || data.length === 0) return;

      const points = data.map(p => [p.lat, p.lon, p.intensity] as [number, number, number]);

      // @ts-ignore — leaflet.heat adds L.heatLayer
      heatLayerRef.current = L.heatLayer(points, {
        radius: 35,
        blur: 25,
        maxZoom: 10,
        max: 1.0,
        minOpacity: 0.3,
        gradient: {
          0.0: '#000033',
          0.2: '#0000FF',
          0.4: '#00FFFF',
          0.6: '#00FF41',
          0.8: '#FFFF00',
          1.0: '#FF0000'
        }
      }).addTo(map);
    }).catch(err => {
      console.warn('leaflet.heat not available:', err);
    });

    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [data, visible, map]);

  return null;
}

export default function Map({ onLocationSelect, selectedLocation, hotspots, substations, heatmapData, heatmapVisible }: MapProps) {
  const [mapStyle, setMapStyle] = useState('dark');

  const tileLayers = {
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri'
    },
    terrain: {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }
  };

  return (
    <div className="relative w-full h-full bg-[#050505]">
      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: '100%', width: '100%', zIndex: 0, background: '#050505' }}
        zoomControl={false}
      >
        <TileLayer
          key={mapStyle}
          attribution={tileLayers[mapStyle as keyof typeof tileLayers].attribution}
          url={tileLayers[mapStyle as keyof typeof tileLayers].url}
        />
        <LocationMarker onLocationSelect={onLocationSelect} selectedLocation={selectedLocation} />
        <MapUpdater selectedLocation={selectedLocation} hotspots={hotspots} />
        <HeatmapLayer data={heatmapData} visible={heatmapVisible} />

        {/* Hotspot circles */}
        {hotspots.map((spot, idx) => (
          <CircleMarker
            key={`hotspot-${idx}`}
            center={[spot.lat, spot.lon]}
            radius={20}
            pathOptions={{ color: '#00FF41', fillColor: '#00FF41', fillOpacity: 0.2, weight: 2 }}
            eventHandlers={{
              click: () => onLocationSelect(spot.lat, spot.lon)
            }}
          >
            <Popup className="font-mono text-xs bg-black text-white border border-[#00FF41]">
              <div className="bg-black text-white p-1">
                <div className="font-bold text-[#00FF41] mb-1">{spot.name}</div>
                <div>Type: {spot.type.toUpperCase()}</div>
                <div className="text-gray-400 mt-1">Click to analyze</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Substation markers */}
        {substations.map((sub, idx) => (
          <Marker
            key={`sub-${idx}`}
            position={[sub.lat, sub.lon]}
            icon={substationIcon}
          >
            <Popup className="font-mono text-xs">
              <div className="bg-black text-white p-2 rounded" style={{ minWidth: 160 }}>
                <div className="font-bold text-[#FFC800] mb-1">⚡ {sub.name}</div>
                <div className="text-gray-300">Type: {sub.type}</div>
                <div className="text-gray-300">Voltage: {sub.voltage}</div>
                <div className="text-[#00FF41] mt-1">{sub.distance_km} km away</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Map Controls */}
      <div className="absolute top-4 right-4 flex gap-2 z-[1000] font-mono text-xs">
        <div className="flex bg-black border border-[#1A1A1A] rounded overflow-hidden">
          <button
            onClick={() => setMapStyle('dark')}
            className={`px-4 py-2 flex items-center gap-2 ${mapStyle === 'dark' ? 'text-[#00FF41] bg-[#1A1A1A]' : 'text-gray-400 hover:text-white'}`}
          >
            <span className="w-3 h-3 border border-current rounded-sm"></span> Dark
          </button>
          <div className="w-px bg-[#1A1A1A]"></div>
          <button
            onClick={() => setMapStyle('satellite')}
            className={`px-4 py-2 flex items-center gap-2 ${mapStyle === 'satellite' ? 'text-[#00FF41] bg-[#1A1A1A]' : 'text-gray-400 hover:text-white'}`}
          >
            <span className="w-3 h-3 border border-current rounded-full"></span> Satellite
          </button>
          <div className="w-px bg-[#1A1A1A]"></div>
          <button
            onClick={() => setMapStyle('terrain')}
            className={`px-4 py-2 flex items-center gap-2 ${mapStyle === 'terrain' ? 'text-[#00FF41] bg-[#1A1A1A]' : 'text-gray-400 hover:text-white'}`}
          >
            <span className="w-3 h-3 border-t-2 border-l-2 border-current transform rotate-45 mt-1"></span> Terrain
          </button>
        </div>
      </div>

      {/* Crosshair targeting overlay */}
      <div className="absolute inset-0 pointer-events-none z-[500] flex items-center justify-center">
        <div className="relative w-12 h-12">
          {/* Horizontal line */}
          <div className="absolute top-1/2 left-0 w-full h-px bg-[#00FF41]/60 -translate-y-px"></div>
          {/* Vertical line */}
          <div className="absolute left-1/2 top-0 h-full w-px bg-[#00FF41]/60 -translate-x-px"></div>
          {/* Center dot */}
          <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-[#00FF41] -translate-x-1 -translate-y-1 shadow-[0_0_8px_rgba(0,255,65,0.6)]"></div>
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-[#00FF41]/80"></div>
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-[#00FF41]/80"></div>
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-[#00FF41]/80"></div>
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-[#00FF41]/80"></div>
        </div>
      </div>

      {/* Heatmap legend */}
      {heatmapVisible && heatmapData.length > 0 && (
        <div className="absolute bottom-12 right-4 z-[1000] bg-black/90 border border-[#1A1A1A] rounded p-3 font-mono text-[10px]">
          <div className="text-[#00FF41] font-bold mb-2 uppercase tracking-wider">Heatmap Legend</div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#FF0000' }}></div>
            <span className="text-gray-300">Best — Ideal for RE</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#FFFF00' }}></div>
            <span className="text-gray-300">Good — Strong Potential</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#00FF41' }}></div>
            <span className="text-gray-300">Average — Moderate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#0000FF' }}></div>
            <span className="text-gray-300">Low — Less Suitable</span>
          </div>
        </div>
      )}
    </div>
  );
}
