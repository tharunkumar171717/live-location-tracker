import { query } from '../db.js';

// Create or refresh the profile row for a verified user.
export async function upsertProfile(user) {
  const { rows } = await query(
    `insert into public.profiles (id, email, full_name, avatar_url)
     values ($1, $2, $3, $4)
     on conflict (id) do update set
       email      = excluded.email,
       full_name  = coalesce(excluded.full_name, profiles.full_name),
       avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
       updated_at = now()
     returning id, email, full_name, avatar_url, created_at, updated_at`,
    [user.id, user.email, user.fullName, user.avatarUrl],
  );
  return rows[0];
}
