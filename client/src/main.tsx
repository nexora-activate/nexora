import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient } from "./query-client";
import "./theme.css";

// Sonde de stabilisation pour les vérifications automatisées de la
// page : nombre de requêtes/mutations en cours (0 = page stabilisée).
// Les deux noms sont posés : celui de l'application et celui, historique,
// que les outils de vérification de l'hébergeur lisent encore.
if (typeof window !== "undefined") {
  const target = window as unknown as Record<string, unknown>;
  const settle = () => queryClient.isFetching() + queryClient.isMutating();
  if (typeof target["__nexoraAuditSettle"] !== "function") {
    target["__nexoraAuditSettle"] = settle;
  }
  if (typeof target["__hatchAuditSettle"] !== "function") {
    target["__hatchAuditSettle"] = settle;
  }
}

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

// Garder `<QueryClientProvider client={queryClient}>` autour de l'app,
// et à la fois la classe `nexora-root` ET l'attribut `data-nexora-root`
// sur le div externe : les styles de theme.css s'appuient dessus pour
// les marges de sécurité mobile (encoches, barre de gestes), la taille
// de la fenêtre et les décalages de l'en-tête de l'hébergeur — les
// retirer casse la mise en page en silence.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="nexora-root" data-nexora-root>
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);

// L'application a démarré : on retire l'écran de démarrage statique écrit
// dans index.html (il ne sert que si le JavaScript ne démarre pas — sans
// lui, l'utilisateur resterait devant cet écran figé). On attend 400 ms
// pour laisser le premier affichage React se dessiner (pas de flash noir
// entre les deux), avec un second essai à 1,5 s sur les téléphones lents.
function removeBootScreen() {
  document.getElementById("nexora-boot")?.remove();
}
window.setTimeout(removeBootScreen, 400);
window.setTimeout(removeBootScreen, 1500);
