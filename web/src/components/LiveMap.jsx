import { Fragment, useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Polyline,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistance } from '../lib/geo.js';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d'];
function colorFor(userId) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const TARGET_COLOR = '#111827';

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

// A click on the map (not a drag) picks a target point.
function PickOnClick({ onPick }) {
  useMapEvents({ click: (e) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// target: {lat, lng} or null. A target placed on a member is drawn as that
// member's marker, so only a free-standing point gets its own marker.
export function LiveMap({ positions, names, selfId, target, targetIsMember, distance, onPickTarget }) {
  const points = Object.values(positions);
  const self = positions[selfId];

  return (
    <MapContainer center={[20, 0]} zoom={2} className="map" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnFirstData points={points} />
      <PickOnClick onPick={onPickTarget} />

      {self && target && (
        <Polyline
          positions={[[self.lat, self.lng], [target.lat, target.lng]]}
          pathOptions={{ color: TARGET_COLOR, weight: 3, dashArray: '8 8', opacity: 0.8 }}
        >
          {distance != null && (
            <Tooltip permanent direction="center" className="distance-tooltip">
              {formatDistance(distance)}
            </Tooltip>
          )}
        </Polyline>
      )}

      {target && !targetIsMember && (
        <CircleMarker
          center={[target.lat, target.lng]}
          radius={8}
          pathOptions={{ color: TARGET_COLOR, weight: 3, fillColor: '#fff', fillOpacity: 1 }}
        >
          <Tooltip direction="top" offset={[0, -8]} permanent>
            Target
          </Tooltip>
        </CircleMarker>
      )}

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
