import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Politique de confidentialité — Upcut",
};

export default function ConfidentialitePage() {
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
          Politique de confidentialité
        </h1>
        <p className="text-sm text-muted-foreground mb-10">Dernière mise à jour : mai 2026</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-3">1. Responsable du traitement</h2>
            <p className="text-muted-foreground">
              Maé Prina (auto-entrepreneur), Hennebont, France —{" "}
              <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">mae.prina@gmail.com</a>
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">2. Données collectées</h2>
            <p className="text-muted-foreground mb-2">Lors de l'utilisation d'Upcut, nous collectons :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Données de compte :</strong> adresse email, nom d'utilisateur, mot de passe (chiffré)</li>
              <li><strong className="text-foreground">Données d'utilisation :</strong> URLs de vidéos soumises, clips générés, historique des jobs</li>
              <li><strong className="text-foreground">Données de facturation :</strong> gérées par Lemon Squeezy (nous ne stockons pas de données bancaires)</li>
              <li><strong className="text-foreground">Données techniques :</strong> logs de connexion, adresse IP (via Supabase et Railway)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">3. Finalités du traitement</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Fournir le service de génération de clips</li>
              <li>Gérer ton compte et ton abonnement</li>
              <li>T'envoyer les emails transactionnels (confirmation, factures)</li>
              <li>Améliorer le service</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">4. Durée de conservation</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Données de compte :</strong> jusqu'à suppression du compte</li>
              <li><strong className="text-foreground">Clips générés :</strong> conservés pendant la durée d'activité du compte</li>
              <li><strong className="text-foreground">Fichiers vidéo temporaires :</strong> supprimés après traitement</li>
              <li><strong className="text-foreground">Logs techniques :</strong> 7 à 30 jours selon l'hébergeur</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">5. Sous-traitants</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Supabase</strong> — authentification et base de données (EU)</li>
              <li><strong className="text-foreground">Railway</strong> — hébergement des serveurs (USA)</li>
              <li><strong className="text-foreground">OpenAI</strong> — transcription audio et analyse IA</li>
              <li><strong className="text-foreground">Resend</strong> — envoi d'emails transactionnels</li>
              <li><strong className="text-foreground">Lemon Squeezy</strong> — paiement et facturation</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">6. Tes droits (RGPD)</h2>
            <p className="text-muted-foreground mb-2">Conformément au RGPD, tu as le droit de :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Accéder à tes données personnelles</li>
              <li>Rectifier des données inexactes</li>
              <li>Supprimer ton compte et tes données</li>
              <li>T'opposer au traitement</li>
              <li>Portabilité de tes données</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              Pour exercer ces droits, contacte-nous à{" "}
              <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">mae.prina@gmail.com</a>.
              Tu peux également introduire une réclamation auprès de la{" "}
              <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">CNIL</a>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">7. Cookies</h2>
            <p className="text-muted-foreground">
              Upcut utilise uniquement des cookies techniques nécessaires au fonctionnement du service (session d'authentification). Aucun cookie publicitaire ou de tracking tiers n'est utilisé.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">8. Contact</h2>
            <p className="text-muted-foreground">
              Pour toute question relative à ta vie privée :{" "}
              <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">mae.prina@gmail.com</a>
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
