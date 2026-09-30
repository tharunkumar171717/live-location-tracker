import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import MapView, { Circle, Marker } from 'react-native-maps';
import { api } from '../../../lib/api.js';
import { useAuth } from '../../../auth/AuthProvider.jsx';
import { useTrackingSession } from '../../../tracking/useTrackingSession.js';
import { useDeviceLocation } from '../../../tracking/useDeviceLocation.js';
import { Button } from '../../../components/Button.jsx';
import { colors, ui } from '../../../ui.js';

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
      >
        {points.map((p) => {
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
