import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { api } from '../../../lib/api.js';
import { useAuth } from '../../../auth/AuthProvider.jsx';
import { useTrackingSession } from '../../../tracking/useTrackingSession.js';
import { useDeviceLocation } from '../../../tracking/useDeviceLocation.js';
import { Button } from '../../../components/Button.jsx';
import { colors, ui } from '../../../ui.js';
import { bearingDegrees, compassDirection, distanceMeters, formatDistance } from '../../../lib/geo.js';
import { TRAVEL_MODES, formatDuration } from '../../../lib/route.js';
import { useRoute } from '../../../tracking/useRoute.js';
import { useSmoothedPosition } from '../../../tracking/useSmoothedPosition.js';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d'];
function colorFor(userId) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function SessionScreen() {
  const { id: sessionId } = useLocalSearchParams();
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sharing, setSharing] = useState(false);
  // {type:'point', lat, lng} | {type:'member', userId} | null
  const [target, setTarget] = useState(null);
  const [travelMode, setTravelMode] = useState('car');
  const mapRef = useRef(null);
  const fitted = useRef(false);
  const requested = useRef(new Set());

  const live = useTrackingSession(sessionId);
  const ended = live.ended || session?.status === 'ended';
  // GPS runs whenever the session is open so you always see yourself on the
  // map; positions are only sent to the server while sharing.
  const geo = useDeviceLocation({ enabled: !ended, onPosition: sharing ? live.sendLocation : undefined });

  // Send the fix we already have as soon as sharing starts.
  const { sendLocation } = live;
  useEffect(() => {
    if (sharing && geo.current) sendLocation(geo.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing, sendLocation]);

  useEffect(() => {
    api.getSession(sessionId).then(setSession).catch((e) => setLoadError(e.message));
  }, [sessionId]);

  // Refetch the roster once per unseen member.
  useEffect(() => {
    if (!session) return;
    const known = new Set(session.members.map((m) => m.user_id));
    const unknown = Object.keys(live.positions).filter((id) => !known.has(id) && !requested.current.has(id));
    if (!unknown.length) return;
    unknown.forEach((id) => requested.current.add(id));
    api.getSession(sessionId).then(setSession).catch(() => {});
  }, [live.positions, session, sessionId]);

  const names = useMemo(
    () => Object.fromEntries((session?.members || []).map((m) => [m.user_id, m.full_name || m.email || 'Member'])),
    [session],
  );
  // Your own marker comes straight from the device, not the server round trip.
  const positions = useMemo(
    () =>
      geo.current
        ? { ...live.positions, [user.id]: { userId: user.id, ...geo.current, recordedAt: geo.current.timestamp } }
        : live.positions,
    [live.positions, geo.current, user.id],
  );
  const points = Object.values(positions);

  // A member target follows that member as their location updates.
  // Predicted between GPS fixes so distance and markers move continuously.
  const self = useSmoothedPosition(positions[user.id]);
  const memberTarget = useSmoothedPosition(target?.type === 'member' ? positions[target.userId] : null);
  const targetPoint = target?.type === 'member' ? memberTarget : target;
  const mapPositions = useMemo(() => {
    const next = { ...positions };
    if (self) next[user.id] = self;
    if (memberTarget) next[target.userId] = memberTarget;
    return next;
  }, [positions, self, memberTarget, user.id, target]);
  const straight = self && targetPoint ? distanceMeters(self, targetPoint) : null;
  const nav = useRoute(self, targetPoint, travelMode);
  // Road distance when we have a route, straight line otherwise.
  const distance = nav.progress ? nav.progress.remaining : straight;
  const routeCoords = nav.progress?.remainingCoords;

  // Re-render every second so "GPS updated Ns ago" stays current.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const gpsAge = self?.recordedAt ? Math.max(0, Math.round((now - new Date(self.recordedAt)) / 1000)) : null;
  const targetLabel = target?.type === 'member' ? names[target.userId] || 'Member' : 'Map point';

  // Fit the camera to everyone the first time positions arrive.
  useEffect(() => {
    if (fitted.current || !points.length || !mapRef.current) return;
    fitted.current = true;
    mapRef.current.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [points]);

  if (loadError) {
    return (
      <View style={[ui.screen, ui.content]}>
        <Text style={ui.error}>{loadError}</Text>
      </View>
    );
  }
  if (!session) return <View style={[ui.screen, ui.content]}><Text style={ui.muted}>Loading…</Text></View>;

  const isOwner = session.role === 'owner';
  const statusColor = live.status === 'connected' ? colors.ok : live.status === 'closed' ? colors.danger : '#f59e0b';

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: session.name }} />
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={{ latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 }}
        onLongPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          setTarget({ type: 'point', lat: latitude, lng: longitude });
        }}
      >
        {routeCoords?.length > 1 && (
          <Polyline
            coordinates={routeCoords.map((c) => ({ latitude: c.lat, longitude: c.lng }))}
            strokeColor="#1a73e8"
            strokeWidth={6}
          />
        )}
        {self && targetPoint && !(routeCoords?.length > 1) && (
          <Polyline
            coordinates={[
              { latitude: self.lat, longitude: self.lng },
              { latitude: targetPoint.lat, longitude: targetPoint.lng },
            ]}
            strokeColor="#111827"
            strokeWidth={3}
            lineDashPattern={[8, 8]}
          />
        )}
        {target?.type === 'point' && (
          <Marker
            coordinate={{ latitude: target.lat, longitude: target.lng }}
            title="Target"
            description={distance != null ? formatDistance(distance) : undefined}
            pinColor="#111827"
          />
        )}
        {Object.values(mapPositions).map((p) => {
          const color = colorFor(p.userId);
          const label = p.userId === user.id ? 'You' : names[p.userId] || 'Member';
          const coordinate = { latitude: p.lat, longitude: p.lng };
          return [
            p.accuracy > 0 && (
              <Circle
                key={`${p.userId}-acc`}
                center={coordinate}
                radius={p.accuracy}
                strokeColor={color}
                strokeWidth={1}
                fillColor={`${color}22`}
              />
            ),
            <Marker
              key={p.userId}
              coordinate={coordinate}
              title={label}
              description={`Updated ${new Date(p.recordedAt).toLocaleTimeString()}`}
              pinColor={color}
            />,
          ];
        })}
      </MapView>

      <ScrollView style={{ maxHeight: '45%' }} contentContainerStyle={ui.content}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View style={ui.row}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
            <Text style={ui.small}>{ended ? 'session ended' : live.status}</Text>
          </View>
          <Text
            style={[ui.small, { color: colors.primary }]}
            onPress={() => Share.share({ message: `Join my G-Map session with code ${session.join_code}` })}
          >
            Code {session.join_code} · Share
          </Text>
        </View>

        {!ended && (
          <Button
            title={sharing ? 'Stop sharing my location' : 'Share my location'}
            variant={sharing ? undefined : 'primary'}
            onPress={() => setSharing((s) => !s)}
          />
        )}
        <View style={[ui.card, { gap: 4 }]}>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.h2}>Distance</Text>
            {target && (
              <Text style={[ui.small, { color: colors.primary }]} onPress={() => setTarget(null)}>
                Clear
              </Text>
            )}
          </View>
          {!target ? (
            <Text style={[ui.muted, ui.small]}>Long-press the map, or pick a member below, to set a target.</Text>
          ) : (
            <>
              <Text style={ui.small}>To {targetLabel}</Text>
              <View style={[ui.row, { gap: 6 }]}>
                {Object.entries(TRAVEL_MODES).map(([key, m]) => {
                  const active = travelMode === key;
                  return (
                    <Text
                      key={key}
                      onPress={() => setTravelMode(key)}
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        paddingVertical: 6,
                        borderRadius: 999,
                        borderWidth: 1,
                        overflow: 'hidden',
                        borderColor: active ? '#1a73e8' : colors.border,
                        backgroundColor: active ? '#1a73e8' : '#fff',
                        color: active ? '#fff' : colors.text,
                      }}
                    >
                      {m.label}
                    </Text>
                  );
                })}
              </View>
              {!self || !targetPoint ? (
                <Text style={[ui.muted, ui.small]}>
                  {!self ? 'Waiting for your location…' : 'Waiting for their location…'}
                </Text>
              ) : nav.progress ? (
                <>
                  <Text style={{ fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.text }}>
                    {formatDistance(nav.progress.remaining)}
                    <Text style={{ fontSize: 18, fontWeight: '600', color: colors.muted }}>
                      {' '}· {formatDuration(nav.progress.eta)}
                    </Text>
                  </Text>
                  <Text style={[ui.muted, ui.small]}>
                    by road{nav.rerouting ? ' · rerouting…' : ''} · {formatDistance(straight)} straight line{' '}
                    {compassDirection(bearingDegrees(self, targetPoint))}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.text }}>
                    {formatDistance(straight)}
                    <Text style={[ui.muted, ui.small]}> {compassDirection(bearingDegrees(self, targetPoint))}</Text>
                  </Text>
                  <Text style={[ui.small, nav.error ? ui.error : ui.muted]}>
                    straight line · {nav.error || (nav.loading ? 'finding road route…' : 'no road route')}
                  </Text>
                </>
              )}
              {self && (
                <Text style={[ui.muted, ui.small]}>
                  GPS {gpsAge != null ? `updated ${gpsAge}s ago` : 'waiting'}
                  {self.accuracy > 0 ? ` · ±${Math.round(self.accuracy)} m` : ''}
                </Text>
              )}
            </>
          )}
        </View>

        {geo.error && <Text style={[ui.error, ui.small]}>{geo.error}</Text>}
        {live.error && <Text style={[ui.error, ui.small]}>{live.error}</Text>}

        <View style={[ui.card, { gap: 8 }]}>
          <Text style={ui.h2}>Members</Text>
          {session.members.map((m) => {
            const p = positions[m.user_id];
            return (
              <View key={m.user_id}>
                <Text style={{ fontWeight: '600' }}>
                  {m.user_id === user.id ? 'You' : names[m.user_id]}
                  {m.role === 'owner' ? '  (owner)' : ''}
                </Text>
                <Text style={[ui.muted, ui.small]}>
                  {p ? `updated ${new Date(p.recordedAt).toLocaleTimeString()}` : 'no location yet'}
                </Text>
                {m.user_id !== user.id && (
                  <Text
                    style={[ui.small, { color: colors.primary }]}
                    onPress={() => setTarget({ type: 'member', userId: m.user_id })}
                  >
                    {target?.userId === m.user_id ? 'Target' : 'Set as target'}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {!ended && isOwner && (
          <Button
            title="End session"
            variant="danger"
            onPress={() =>
              Alert.alert('End session?', 'This stops tracking for everyone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'End',
                  style: 'destructive',
                  onPress: async () => {
                    const s = await api.endSession(sessionId);
                    setSession((prev) => ({ ...prev, ...s }));
                    setSharing(false);
                  },
                },
              ])
            }
          />
        )}
        {!isOwner && (
          <Button
            title="Leave session"
            onPress={async () => {
              await api.leaveSession(sessionId);
              router.back();
            }}
          />
        )}
      </ScrollView>
    </View>
  );
}
