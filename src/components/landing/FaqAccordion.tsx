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
    <div className="space-y-3">
      {FAQ_ITEMS.map((item) => (
        <details
          key={item.q}
          className="group rounded-2xl border border-[#e5e5e7] bg-white px-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-colors hover:border-[#d2d2d7]"
        >
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold text-[#1d1d1f] [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#e5e5e7] bg-[#f5f5f7] transition-transform duration-150 group-open:rotate-180">
              <ChevronDown className="size-3.5 text-[#1d1d1f]/60" />
            </span>
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-[#1d1d1f]/60">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
