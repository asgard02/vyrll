import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";

type ClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  clips?: unknown[];
  created_at: string;
};

type FlattenedClip = {
  jobId: string;
  index: number;
  created_at: string;
  title: string;
  downloadUrl: string;
};

async function fetchClips(): Promise<FlattenedClip[]> {
  const hdrs = await headers();
  const protocol = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");

  if (!host) {
    return [];
  }

  const baseUrl = `${protocol}://${host}`;
  const res = await fetch(`${baseUrl}/api/clips`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  const jobs: ClipJob[] = Array.isArray(data.jobs) ? data.jobs : [];

  const flattened: FlattenedClip[] = jobs.flatMap((job) => {
    const clips = Array.isArray(job.clips) ? job.clips : [];
    return clips.map((_, index) => {
      const title =
        (job.video_title && job.video_title.trim().length > 0
          ? job.video_title
          : job.url.replace(/^https?:\/\//, "")) ?? job.url;

      return {
        jobId: job.id,
        index,
        created_at: job.created_at,
        title,
        downloadUrl: `/api/clips/${job.id}/download/${index}`,
      };
    });
  });

  return flattened.sort((a, b) => {
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    if (da === db) return a.index - b.index;
    return db - da;
  });
}

export default async function ClipsDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const clips = await fetchClips();

  return (
    <AppShell activeItem="accueil">
        <main className="flex-1 flex flex-col items-center min-h-[calc(100vh-52px)] px-6 pt-8 pb-12">
          <div className="w-full max-w-5xl flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 w-fit">
                <span className="font-mono text-[10px] text-primary uppercase tracking-wider">
                  Dev only
                </span>
              </div>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-white">
                Vue brute des clips
              </h1>
              <p className="font-mono text-xs text-zinc-500">
                Page de debug pour lister tous les clips générés, sans la couche
                projets. Non exposée en production.
              </p>
            </div>

            {clips.length === 0 ? (
              <p className="font-mono text-sm text-zinc-500">
                Aucun clip trouvé. Lance une génération sur la page clips pour
                voir les résultats ici.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {clips.map((clip) => (
                  <div
                    key={`${clip.jobId}-${clip.index}`}
                    className="rounded-2xl border border-border bg-card overflow-hidden hover:border-input transition-all"
                  >
                    <div className="relative aspect-[9/16] bg-black">
                      <video
                        src={clip.downloadUrl}
                        controls
                        playsInline
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                      <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-black/60 font-mono text-[10px] text-white">
                        Job {clip.jobId.slice(0, 8)} · Clip {clip.index + 1}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <p className="font-mono text-xs text-zinc-400 truncate" title={clip.title}>
                        {clip.title}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-600">
                        {new Date(clip.created_at).toLocaleString("fr-FR")}
                      </p>
                      <a
                        href={clip.downloadUrl}
                        download={`clip-${clip.jobId}-${clip.index + 1}.mp4`}
                        className="inline-flex items-center gap-2 font-mono text-[11px] text-primary hover:text-primary/80"
                      >
                        Télécharger
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
    </AppShell>
  );
}

