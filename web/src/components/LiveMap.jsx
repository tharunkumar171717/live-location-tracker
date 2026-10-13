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
// Each person gets the next unused color the first time they're seen, so up
// to eight people on one map never share a color (a hash of the id collides).
const assigned = new Map();
export function colorFor(userId) {
  if (!assigned.has(userId)) assigned.set(userId, COLORS[assigned.size % COLORS.length]);
  return assigned.get(userId);
}

const TARGET_COLOR = '#111827';
const ROUTE_COLOR = '#1a73e8';
const ZONE_COLOR = '#0d9488';

// Fit to everyone as people appear (positions often arrive one by one), until
// the user pans or zooms; after that, leave the view alone.
function FitToData({ points }) {
  const map = useMap();
  const fitted = useRef(0); // how many points the current view includes
  const touched = useRef(false);

  useEffect(() => {
    const el = map.getContainer();
    const touch = () => (touched.current = true);
    map.on('dragstart', touch);
    el.addEventListener('wheel', touch, { passive: true });
    el.addEventListener('dblclick', touch);
    return () => {
      map.off('dragstart', touch);
      el.removeEventListener('wheel', touch);
      el.removeEventListener('dblclick', touch);
    };
  }, [map]);

  useEffect(() => {
    if (touched.current || points.length <= fitted.current) return;
    fitted.current = points.length;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
    else map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

// A click on the map (not a drag) picks a point.
function PickOnClick({ onPick }) {
  useMapEvents({ click: (e) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// target: {lat, lng} or null. A target placed on a member is drawn as that
// member's marker, so only a free-standing point gets its own marker.
// routeCoords: the remaining road route [{lat, lng}], or null to fall back to
// a straight dashed line.
// geofences: [{id, name, lat, lng, radius_m}]; draftZone: a zone being placed.
// trails: {userId: [[lat, lng], ...]} drawn under the markers (replay).
export function LiveMap({
  positions,
  names,
  selfId,
  target,
  targetIsMember,
  distance,
  routeCoords,
  onPick,
  geofences = [],
  draftZone,
  trails,
  fitPoints,
}) {
  const points = Object.values(positions);
  const self = selfId ? positions[selfId] : null;

  return (
    <MapContainer center={[12.9716, 77.5946]} zoom={12} className="map" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToData points={fitPoints || points} />
      {onPick && <PickOnClick onPick={onPick} />}

      {geofences.map((z) => (
        <Circle
          key={z.id}
          center={[z.lat, z.lng]}
          radius={z.radius_m}
          pathOptions={{ color: ZONE_COLOR, weight: 2, dashArray: '6 6', fillOpacity: 0.08 }}
        >
          <Tooltip direction="center" className="zone-tooltip" permanent>
            {z.name}
          </Tooltip>
        </Circle>
      ))}
      {draftZone && (
        <Circle
          center={[draftZone.lat, draftZone.lng]}
          radius={draftZone.radiusM}
          pathOptions={{ color: ZONE_COLOR, weight: 2, fillOpacity: 0.2 }}
        />
      )}

      {trails &&
        Object.entries(trails).map(([userId, coords]) =>
          coords.length > 1 ? (
            <Polyline key={userId} positions={coords} pathOptions={{ color: colorFor(userId), weight: 4, opacity: 0.7 }} />
          ) : null,
        )}

      {routeCoords?.length > 1 && (
        <>
          <Polyline
            positions={routeCoords.map((c) => [c.lat, c.lng])}
            pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }}
          />
          <Polyline positions={routeCoords.map((c) => [c.lat, c.lng])} pathOptions={{ color: ROUTE_COLOR, weight: 6 }}>
            {distance != null && (
              <Tooltip permanent direction="center" className="distance-tooltip">
                {formatDistance(distance)}
              </Tooltip>
            )}
          </Polyline>
        </>
      )}

      {self && target && !(routeCoords?.length > 1) && (
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
              pathOptions={{ color: '#fff', weight: 3, fillColor: color, fillOpacity: p.stale ? 0.4 : 1 }}
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
