// Client de requêtes LOCAL pour le build autonome (Render) : le build
// du client (client/build.mjs) branche ce module à la place de
// client/src/query-client.ts quand l'application est construite HORS
// de la plateforme historique — là où l'instance partagée de la
// plateforme n'existe pas.
//
// Réglages prudents, identiques en esprit à ceux de la plateforme :
// pas de réessais en rafale (seules les erreurs serveur 5xx sont
// retentées, deux fois, avec un délai exponentiel), données fraîches
// 30 s, pas de relecture au retour sur la fenêtre. Une mutation sans
// onError ni onSettled affiche son échec dans la notice du bas de
// page : un enregistrement raté n'est jamais silencieux.
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ActionError } from "../client/src/api";
import { showFailureNotice } from "../client/src/failure-notice";

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (
        mutation.options.onError === undefined &&
        mutation.options.onSettled === undefined
      ) {
        showFailureNotice(error);
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        error instanceof ActionError &&
        error.status >= 500 &&
        failureCount < 2,
      retryDelay: (failureCount) =>
        Math.min(30_000, 1_000 * 2 ** failureCount) * (0.5 + Math.random() / 2),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
