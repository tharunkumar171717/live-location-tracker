import { Fragment, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d'];
function colorFor(userId) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

// Fit to everyone once the first positions arrive; after that, leave the
// view alone so the user can pan freely.
function FitOnFirstData({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    fitted.current = true;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
    else map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export function LiveMap({ positions, names, selfId }) {
  const points = Object.values(positions);

  return (
    <MapContainer center={[20, 0]} zoom={2} className="map" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnFirstData points={points} />
      {points.map((p) => {
        const color = colorFor(p.userId);
        const label = p.userId === selfId ? 'You' : names[p.userId] || 'Member';
        return (
          <Fragment key={p.userId}>
            {p.accuracy > 0 && (
              <Circle center={[p.lat, p.lng]} radius={p.accuracy} pathOptions={{ color, weight: 1, fillOpacity: 0.08 }} />
            )}
            <CircleMarker
              center={[p.lat, p.lng]}
              radius={9}
              pathOptions={{ color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent>
                {label}
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
