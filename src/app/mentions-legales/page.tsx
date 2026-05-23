import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Mentions légales — Upcut",
};

export default function MentionsLegalesPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] px-4 py-16">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Retour
        </Link>

        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground mb-2">
          Mentions légales
        </h1>
        <p className="text-sm text-muted-foreground mb-10">Dernière mise à jour : mai 2026</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-3">Éditeur du site</h2>
            <p>Le site <strong>upcut.app</strong> est édité par :</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Nom :</strong> Maé Prina</li>
              <li><strong className="text-foreground">Statut :</strong> Auto-entrepreneur</li>
              <li><strong className="text-foreground">Ville :</strong> Hennebont, France</li>
              <li><strong className="text-foreground">Email :</strong>{" "}
                <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">
                  mae.prina@gmail.com
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">Hébergement</h2>
            <ul className="space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Hébergeur :</strong> Railway Corp.</li>
              <li><strong className="text-foreground">Adresse :</strong> 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis</li>
              <li><strong className="text-foreground">Site :</strong>{" "}
                <a href="https://railway.app" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  railway.app
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">Propriété intellectuelle</h2>
            <p className="text-muted-foreground">
              L'ensemble du contenu de ce site (textes, images, logo, interface) est la propriété exclusive de Maé Prina, sauf mentions contraires. Toute reproduction, distribution ou utilisation sans autorisation préalable est interdite.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">Données personnelles</h2>
            <p className="text-muted-foreground">
              Pour toute question relative à tes données personnelles, consulte notre{" "}
              <Link href="/confidentialite" className="text-primary hover:underline">
                politique de confidentialité
              </Link>{" "}
              ou contacte-nous à{" "}
              <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">
                mae.prina@gmail.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">Contact</h2>
            <p className="text-muted-foreground">
              Pour toute question : <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">mae.prina@gmail.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
