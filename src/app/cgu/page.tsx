import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Conditions générales d'utilisation — Upcut",
};

export default function CguPage() {
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
          Conditions générales d'utilisation
        </h1>
        <p className="text-sm text-muted-foreground mb-10">Dernière mise à jour : mai 2026</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-3">1. Présentation du service</h2>
            <p className="text-muted-foreground">
              Upcut est un service en ligne permettant de générer automatiquement des clips courts à partir de vidéos YouTube ou Twitch, avec sous-titres générés par IA. Le service est édité par Maé Prina (auto-entrepreneur), Hennebont, France.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">2. Acceptation des CGU</h2>
            <p className="text-muted-foreground">
              En créant un compte sur Upcut, tu acceptes les présentes conditions générales d'utilisation. Si tu n'acceptes pas ces conditions, tu ne dois pas utiliser le service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">3. Accès au service</h2>
            <p className="text-muted-foreground">
              Upcut est accessible à toute personne disposant d'un compte créé sur la plateforme. Le service est actuellement en phase bêta — des interruptions ou ralentissements peuvent survenir sans préavis. Nous ne garantissons pas une disponibilité permanente du service pendant cette phase.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">4. Utilisation du service</h2>
            <p className="text-muted-foreground mb-2">Tu t'engages à :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Utiliser le service uniquement pour des contenus dont tu détiens les droits ou qui sont libres de droits</li>
              <li>Ne pas soumettre de contenus illégaux, diffamatoires, ou portant atteinte aux droits de tiers</li>
              <li>Respecter les conditions d'utilisation de YouTube et Twitch</li>
              <li>Ne pas tenter de contourner les limitations du service</li>
              <li>Ne pas utiliser le service à des fins commerciales non autorisées</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">5. Propriété intellectuelle des contenus</h2>
            <p className="text-muted-foreground">
              Tu restes propriétaire des contenus que tu soumets. En utilisant Upcut, tu accordes une licence temporaire permettant le traitement de tes vidéos dans le seul but de générer les clips demandés. Les clips générés t'appartiennent. Upcut n'est pas responsable des violations de droits d'auteur commises par les utilisateurs.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">6. Abonnements et paiements</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Les abonnements sont facturés mensuellement via Lemon Squeezy</li>
              <li>Les paiements sont non remboursables sauf disposition légale contraire</li>
              <li>Tu peux annuler ton abonnement à tout moment depuis tes paramètres — l'accès reste actif jusqu'à la fin de la période payée</li>
              <li>Les crédits non utilisés ne sont pas reportés au mois suivant</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">7. Limitation de responsabilité</h2>
            <p className="text-muted-foreground">
              Upcut est fourni "tel quel", notamment en phase bêta. Nous ne garantissons pas la qualité ou la disponibilité des clips générés. Notre responsabilité est limitée au montant payé pour le mois en cours. Nous ne sommes pas responsables des pertes indirectes, perte de données, ou interruptions de service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">8. Résiliation</h2>
            <p className="text-muted-foreground">
              Tu peux supprimer ton compte à tout moment depuis tes paramètres. Nous nous réservons le droit de suspendre ou supprimer tout compte en cas de violation des présentes CGU, sans préavis ni remboursement.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">9. Modifications des CGU</h2>
            <p className="text-muted-foreground">
              Nous nous réservons le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront informés par email en cas de modification substantielle. La poursuite de l'utilisation du service après modification vaut acceptation des nouvelles conditions.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">10. Droit applicable</h2>
            <p className="text-muted-foreground">
              Les présentes CGU sont soumises au droit français. En cas de litige, les tribunaux compétents sont ceux du ressort de Hennebont (France).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">11. Contact</h2>
            <p className="text-muted-foreground">
              Pour toute question :{" "}
              <a href="mailto:mae.prina@gmail.com" className="text-primary hover:underline">mae.prina@gmail.com</a>
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
