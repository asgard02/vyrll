type AuthUserRow = {
  email?: string | null;
  email_confirmed_at?: string | null;
};

/** True when this address already belongs to a confirmed account. */
export async function confirmedAccountEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return false;

  const endpoint = new URL("/auth/v1/admin/users", supabaseUrl);
  endpoint.searchParams.set("filter", normalized);
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("per_page", "20");

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { users?: AuthUserRow[] };
    return (body.users ?? []).some(
      (user) =>
        (user.email ?? "").trim().toLowerCase() === normalized &&
        Boolean(user.email_confirmed_at)
    );
  } catch {
    return false;
  }
}
