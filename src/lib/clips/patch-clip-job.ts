import { patchClipJobAtIndex } from "../../../backend-clips/clip-patch.js";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Patch un seul clip. RPC si la fonction existe, sinon relecture fraîche. */
export async function patchClipJobRow(
  admin: Admin,
  jobId: string,
  userId: string,
  index: number,
  patch: Record<string, unknown>
) {
  return patchClipJobAtIndex({
    jobId,
    index,
    patch,
    rpc: (name: string, args: Record<string, unknown>) => admin.rpc(name, args),
    read: async () => {
      const { data, error } = await admin
        .from("clip_jobs")
        .select("clips")
        .eq("id", jobId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !Array.isArray(data?.clips)) {
        return { error: error || new Error("clip_jobs missing") };
      }
      return { clips: data.clips };
    },
    write: async (clips: unknown) => {
      const { error } = await admin
        .from("clip_jobs")
        .update({ clips })
        .eq("id", jobId)
        .eq("user_id", userId);
      return { error: error || null };
    },
  });
}
