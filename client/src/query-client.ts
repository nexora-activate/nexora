// Le client de requêtes partagé de la plateforme d'hébergement
// historique de NEXORA : quand l'application est construite par cette
// plateforme (dans l'appli Muse), c'est son instance TanStack Query
// partagée qui est utilisée — réglages de cache, de réessais et notice
// d'échec sont les siens, comme avant.
//
// Pour le serveur autonome (Render), le build du client remplace ce
// module par `standalone/query-client.ts` (voir client/build.mjs) : une
// instance locale aux mêmes réglages, sans aucune dépendance à la
// plateforme. Le reste du code ne voit aucune différence.
import { spaceQueryClient } from "@hatch/space-sdk/client";

export const queryClient = spaceQueryClient;
