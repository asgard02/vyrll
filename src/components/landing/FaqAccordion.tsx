import { ChevronDown } from "lucide-react";

const FAQ_ITEMS = [
  { q: "Ça marche avec Twitch aussi ?", a: "Oui. Tu colles l'URL d'une VOD ou d'un contenu compatible ; le flux est traité comme une vidéo source pour en extraire des clips." },
  { q: "Combien de temps ça prend ?", a: "Ça dépend de la durée de la vidéo et de la file. En pratique, compte quelques minutes pour une vidéo classique — tu suis l'avancement depuis ton espace." },
  { q: "Les sous-titres sont inclus ?", a: "Oui. Transcription + sous-titres stylés sur les clips exportés, pour coller aux habitudes TikTok / Reels / Shorts." },
  { q: "Comment fonctionne le temps vidéo ?", a: "On compte environ 1 minute de vidéo source par minute de quota. Ton temps restant est visible dans ton profil selon ton plan." },
  { q: "Puis-je annuler mon abonnement ?", a: "Oui. Tu gères ton plan depuis les paramètres ; le gratuit reste sans engagement." },
];

export function FaqAccordion() {
  return (
    <div className="rounded-2xl border border-border bg-white px-6 shadow-sm">
      {FAQ_ITEMS.map((item, i) => (
        <details
          key={item.q}
          className={`group ${i < FAQ_ITEMS.length - 1 ? "border-b border-border" : ""}`}
        >
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground hover:text-primary transition-colors [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
