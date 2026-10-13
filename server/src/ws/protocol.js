// WebSocket protocol: every message a client may send, as a Zod schema.
// Anything that doesn't parse is rejected before it reaches a handler, so
// handlers can trust shapes and types.
//
// Client -> server
//   {type:'auth', token}              first message (within WS_AUTH_TIMEOUT_MS);
//                                     resend whenever the client refreshes its token
//   {type:'auth_share', token}        view-only access through a share link
//   {type:'join' | 'leave', sessionId}
//   {type:'location', sessionId, lat, lng, accuracy?, heading?, speed?, timestamp?}
//   {type:'location_batch', sessionId, ref, points:[{lat, lng, ..., timestamp}]}
//                                     points buffered while offline; acked with batch_ack
//   {type:'ping'}
//
// Server -> client
//   {type:'auth_ok', userId, expiresAt} | {type:'auth_share_ok', sessionId, expiresAt}
//   {type:'joined', sessionId, status, latest:[...]}
//   {type:'location', sessionId, userId, lat, lng, accuracy, heading, speed, recordedAt}
//   {type:'batch_ack', sessionId, ref, accepted}
//   {type:'geofence', sessionId, geofenceId, name, userId, kind:'enter'|'exit', occurredAt}
//   {type:'geofences_changed', sessionId}
//   {type:'session_ended' | 'removed', sessionId}
//   {type:'share_expired' | 'share_revoked'}
//   {type:'auth_expired'}             token expired; send a fresh {type:'auth'}
//   {type:'error', code, message, sessionId?}
//     codes: unauthorized, bad_request, not_found, session_ended, rate_limited,
//            forbidden, internal
import { z } from 'zod';

const sessionId = z.uuid();
const optionalNumber = z.number().finite().nullish();

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: optionalNumber,
  heading: optionalNumber,
  speed: optionalNumber,
  timestamp: z.union([z.number().finite(), z.string().max(40)]).nullish(),
});

export const MAX_BATCH_POINTS = 500;

export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1).max(8192) }),
  z.object({ type: z.literal('auth_share'), token: z.string().min(16).max(128) }),
  z.object({ type: z.literal('join'), sessionId }),
  z.object({ type: z.literal('leave'), sessionId }),
  pointSchema.extend({ type: z.literal('location'), sessionId }),
  z.object({
    type: z.literal('location_batch'),
    sessionId,
    ref: z.string().max(64).optional(),
    points: z.array(pointSchema).min(1).max(MAX_BATCH_POINTS),
  }),
  z.object({ type: z.literal('ping') }),
]);

// Returns {ok:true, msg} or {ok:false, message} with a short readable reason.
export function parseClientMessage(raw) {
  const result = clientMessage.safeParse(raw);
  if (result.success) return { ok: true, msg: result.data };
  const issue = result.error.issues[0];
  const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, message: `${where}${issue?.message || 'Invalid message'}` };
}
