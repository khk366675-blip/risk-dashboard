import type { MobileNote, MobileSnapshot } from '../mobile-dashboard.ts';

export type MobileCloudEnv = {
  url: string;
  secret: string;
};

export function mobileCloudEnv(): MobileCloudEnv | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secret =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && secret ? { url, secret } : null;
}

async function rest<T>(
  env: MobileCloudEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.secret);
  headers.set('Authorization', `Bearer ${env.secret}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`모바일 저장소 요청 실패 (${response.status}): ${detail}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function readRemoteSnapshot(env: MobileCloudEnv) {
  const rows = await rest<
    { payload: MobileSnapshot; generated_at: string }[]
  >(
    env,
    'mobile_snapshots?id=eq.primary&select=payload,generated_at&limit=1',
  );
  return rows[0]?.payload ?? null;
}

export async function publishRemoteSnapshot(
  env: MobileCloudEnv,
  snapshot: MobileSnapshot,
) {
  return rest<{ id: string; generated_at: string }[]>(
    env,
    'mobile_snapshots?on_conflict=id&select=id,generated_at',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        id: 'primary',
        schema_version: snapshot.schema_version,
        generated_at: snapshot.generated_at,
        updated_at: snapshot.generated_at,
        payload: snapshot,
      }),
    },
  );
}

export async function readRemoteNotes(
  env: MobileCloudEnv,
  onlyUnconsumed = false,
) {
  const filter = onlyUnconsumed ? '&consumed_at=is.null' : '';
  return rest<MobileNote[]>(
    env,
    `mobile_notes?select=id,code,body,created_at,consumed_at${filter}&order=created_at.desc&limit=100`,
  );
}

export async function createRemoteNote(
  env: MobileCloudEnv,
  value: { code: string; body: string },
) {
  const rows = await rest<MobileNote[]>(env, 'mobile_notes?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(value),
  });
  return rows[0];
}

export async function markRemoteNoteConsumed(
  env: MobileCloudEnv,
  id: string,
  consumedAt: string,
) {
  await rest<unknown>(env, `mobile_notes?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ consumed_at: consumedAt }),
  });
}
