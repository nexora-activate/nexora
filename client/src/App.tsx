// NEXORA — plateforme Discord : comptes réels, serveurs sur commande,
// sniko bot avec abonnements réels, tableau de bord Patron.
//
// En haut à droite, sur toutes les pages : le sélecteur de langue
// (English / Français / Español / العربية / Русский), un menu déroulant
// sombre aux couleurs du site qui traduit tout. Une fois connecté, le
// bouton en haut à gauche ouvre un panneau latéral qui glisse depuis la
// gauche avec les trois liens en anglais : Contact Support / Create your
// Discord server / Add the Discord bot. La bannière de l'écran d'entrée
// est l'image Luffy Gear 5 fournie par sniko.

import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./safe-area";
import { actionFields } from "./fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";
import {
I18nProvider,
LANGS,
useI18n,
type I18n,
type Lang,
type MsgKey,
} from "./i18n";
import bannerImg from "./assets/banner-luffy.jpg";
import heroImg from "./assets/hero-accueil.webp";
import botImg from "./assets/sniko-bot.webp";
import logoImg from "./assets/nexora-logo.png";

type User = NonNullable<ApiResponse<typeof api, "getSession">["user"]>;
type BotItem = ApiResponse<typeof api, "getMyStuff">["bots"][number];
type AdminServer = ApiResponse<typeof api, "adminListServers">["servers"][number];
type AdminBot = ApiResponse<typeof api, "adminListBots">["bots"][number];
type AdminSupport = ApiResponse<typeof api, "adminListSupportMessages">["messages"][number];

const TOKEN_KEY = "snikolabs-token";

// Limites des champs de formulaire, lues depuis les schémas des actions
// serveur (platformVersion 29) : la page et le serveur ne peuvent pas
// être en désaccord.
const FIELDS = actionFields<typeof Actions>();

// ---------------------------------------------------------------------------
// Accès au stockage du navigateur, toujours protégé. Dans certains
// navigateurs (stockage bloqué par les réglages, vue intégrée, navigation
// privée stricte), lire ou écrire localStorage LÈVE une erreur au lieu de
// répondre. Sans protection, le tout premier affichage plante avant même de
// dessiner quoi que ce soit — et comme le fond de la page est noir,
// l'utilisateur ne voit qu'un écran noir et ne peut pas se connecter. En
// cas d'échec, une copie en mémoire prend le relais : l'app marche quand
// même, la session dure juste le temps de la visite.
// ---------------------------------------------------------------------------

const memoryStorage = new Map<string, string>();

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
}

function safeSetItem(key: string, value: string) {
  memoryStorage.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible : la copie en mémoire ci-dessus prend le relais
  }
}

function safeRemoveItem(key: string) {
  memoryStorage.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // stockage indisponible : la copie en mémoire est déjà effacée
  }
}

// ---------------------------------------------------------------------------
// Petits utilitaires d'affichage
// ---------------------------------------------------------------------------

function formatRemaining(endsAtIso: string, now: number, i18n: I18n): string {
  const diff = new Date(endsAtIso).getTime() - now;
  if (diff <= 0) return i18n.t("expired");
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return i18n.t("remDays", { d: days, h: hours });
  if (hours > 0) return i18n.t("remHours", { h: hours, m: minutes });
  return i18n.t("remMinutes", { m: minutes });
}

function euros(cents: number, i18n: I18n): string {
  if (cents === 0) return i18n.t("free");
  // 399 → « 3,99 € » ; 1000 → « 10 € » (pas de « ,00 » inutile).
  return cents % 100 === 0
    ? `${cents / 100} €`
    : `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

const SERVER_STATUS_CLS: Record<string, string> = {
  en_attente_paiement: "bg-[#f0b232] text-black",
  en_attente: "bg-[#33333a] text-white",
  en_cours: "bg-white text-black",
  termine: "bg-[#23a55a] text-white",
  annule: "bg-[#f23f43] text-white",
};

const SERVER_STATUS_KEY: Record<string, MsgKey> = {
  en_attente_paiement: "statusPendingPayment",
  en_attente: "statusQueued",
  en_cours: "statusBuilding",
  termine: "statusDone",
  annule: "statusCancelled",
};

const BOT_PLAN_KEY: Record<string, MsgKey> = {
  gratuit: "planFree",
  premium: "planPremium",
  premium_plus: "planPremiumPlus",
  annuel: "planAnnual",
};

function planLabel(plan: string, i18n: I18n): string {
  const key = BOT_PLAN_KEY[plan];
  return key ? i18n.t(key) : plan;
}

// Badge d'offre : or pour les offres payantes, neutre pour le gratuit.
const PLAN_BADGE_CLS: Record<string, string> = {
  gratuit: "bg-[#33333a] text-white",
  premium: "bg-[#f0b232] text-black",
  premium_plus: "bg-[#f0b232] text-black",
  annuel: "bg-[#f0b232] text-black",
};

// Avatar Discord : l'URL officielle du CDN Discord, construite avec
// l'ID du compte et le hash d'avatar stockés côté serveur. Sans hash
// (avatar par défaut de Discord), on calcule l'avatar par défaut.
function discordAvatarUrl(discordId: string, avatar: string): string {
  if (avatar) return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
  let index = 0;
  try {
    index = Number(BigInt(discordId) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// Petit easter egg : le pseudo « sniko » ne donne plus le rôle Patron
// (le rôle est lié à l'adresse e-mail du Patron, côté serveur) — à la
// place, le site affiche « voleur » pour ce pseudo.
function isThiefName(username: string): boolean {
  return username.trim().toLowerCase() === "sniko";
}

function displayName(user: User, i18n: I18n): string {
  return isThiefName(user.username) ? i18n.t("thiefNote") : user.username;
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>
      {text}
    </span>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-[#f23f43]/15 px-4 py-3 text-sm font-medium text-[#ff8589]">
      {message}
    </p>
  );
}

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[#0a0a0c] px-4 py-3 text-base text-[var(--text)] placeholder:text-[#87898c] focus:border-white focus:outline-none";
const labelCls = "mb-1.5 block text-sm font-bold text-[var(--text)]";
const primaryBtn =
  "w-full rounded-xl bg-white px-4 py-3 text-base font-semibold text-black transition hover:bg-[#dcdce0] disabled:opacity-50";
const greenBtn =
  "w-full rounded-xl bg-white px-4 py-3 text-base font-semibold text-black transition hover:bg-[#dcdce0] disabled:opacity-50";

// ---------------------------------------------------------------------------
// Sélecteur de langue (en haut à droite, sur toutes les pages) : bouton avec
// le nom de la langue actuelle, qui ouvre un panneau sombre aux couleurs du
// site (pas le menu système du téléphone). La langue choisie est cochée.
// ---------------------------------------------------------------------------

function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  const current = LANGS.find((l) => l.code === lang) ?? { code: "en" as Lang, label: "English" };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language")}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold text-[var(--text)] shadow-lg transition hover:bg-[var(--surface-alt)]"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[var(--dim)]">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        <span>{current.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-[var(--dim)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="listbox"
            aria-label={t("language")}
            className="animate-menu-in absolute end-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-2xl"
          >
            {LANGS.map((l) => {
              const selected = l.code === lang;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-bold transition ${
                    selected
                      ? "bg-white text-black"
                      : "text-[var(--text)] hover:bg-white/10"
                  }`}
                >
                  <span>{l.label}</span>
                  {selected && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bouton « Se connecter avec Discord » : démarre le vrai flux OAuth2
// (action startDiscordLogin) et ouvre l'adresse d'autorisation Discord
// dans le même onglet (Discord refuse l'affichage dans un cadre).
// Discord renvoie ensuite l'utilisateur sur l'adresse de retour
// enregistrée, avec ?code=&state= dans l'adresse : la racine de l'app
// termine la connexion (voir Root). Si la configuration Discord n'est
// pas en place, le serveur répond un message clair (« Discord login not
// configured ») qui s'affiche sous le bouton au lieu de planter.
// Utilisé sur l'écran de connexion (sans jeton) et dans le tableau de
// bord (avec jeton, pour lier le Discord au compte connecté).
// ---------------------------------------------------------------------------

function DiscordButton({ token }: { token?: string }) {
  const i18n = useI18n();
  const { t, te } = i18n;
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async () => await api.startDiscordLogin(token ? { token } : {}),
    onSuccess: (res) => {
      if (res.ok) {
        setAuthUrl(res.url);
        // Même onglet (pas de nouvel onglet) : sur téléphone, un nouvel
        // onglet rend le retour plus lent et l'écran de chargement reste
        // affiché ; ici l'onglet a déjà le site en mémoire, donc le retour
        // Discord redémarre vite. Discord refuse l'affichage dans un
        // cadre, mais une navigation normale dans l'onglet marche.
        window.location.assign(res.url);
      } else {
        setError(te(res.error));
      }
    },
    onError: () => setError(t("genericError")),
  });

  return (
    <div>
      <button
        type="button"
        disabled={start.isPending}
        onClick={() => {
          setError(null);
          setAuthUrl(null);
          start.mutate();
        }}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] bg-[#17171b] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#202027] disabled:opacity-50"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
        </svg>
        {start.isPending ? t("discordOpening") : t("discordLogin")}
      </button>
      {authUrl && (
        <p className="mt-2 text-center text-sm text-[var(--dim)]">
          {t("discordFallback")}{" "}
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-white underline underline-offset-4"
          >
            {t("discordOpenLink")}
          </a>
        </p>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran d'entrée : connexion / création de compte
// ---------------------------------------------------------------------------

function EntryScreen({ onAuth }: { onAuth: (token: string) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [mode, setMode] = useState<"login" | "signup">("login");
  return (
    <div className="w-full px-3 pb-10 sm:px-5 lg:mx-auto lg:max-w-5xl">
      {/* Barre du haut : logo à gauche, langue en haut à droite */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-2">
          <img src={logoImg} alt="" className="h-8 w-8 rounded-full" />
          <span className="text-sm font-black tracking-wide">NEXORA</span>
        </div>
        <LanguagePicker />
      </div>

      {/* Sur PC : bannière + logo à gauche, formulaire à droite.
          Sur téléphone : tout est empilé et prend toute la largeur de l'écran. */}
      <div className="lg:mt-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        <div>
          {/* Bannière du site (image fournie par sniko), en haut de la page */}
          <img
            src={bannerImg}
            alt={t("heroAlt")}
            className="mt-4 w-full rounded-2xl lg:mt-0"
          />
          <img
            src={logoImg}
            alt={t("logoAlt")}
            className="mx-auto mt-5 h-32 w-32 rounded-full"
          />
          <h1 className="mt-4 text-center text-4xl font-black tracking-tight">NEXORA</h1>
          <p className="mt-2 text-center text-base text-[var(--dim)]">{t("tagline")}</p>
        </div>
        <div>
          <div className="mt-6 rounded-2xl bg-[var(--surface)] p-5 lg:mt-0">
        {mode === "login" ? (
          <LoginForm onAuth={onAuth} />
        ) : (
          <SignupForm onAuth={onAuth} />
        )}
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-base">
        {mode === "login" ? (
          <>
            <span className="text-[var(--dim)]">{t("noAccount")}</span>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className="px-2 font-bold text-white underline decoration-white decoration-2 underline-offset-4"
            >
              {t("createAccount")}
            </button>
          </>
        ) : (
          <>
            <span className="text-[var(--dim)]">{t("haveAccount")}</span>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="px-2 font-bold text-white underline decoration-white decoration-2 underline-offset-4"
            >
              {t("loginTitle")}
            </button>
          </>
        )}
          </div>
        </div>
      </div>

      {/* Page d'accueil publique : présentation de sniko bot, ses commandes
          et les offres — visible dès l'arrivée, sans avoir de compte. */}
      <div className="mt-8 space-y-4">
        <CommandsSection />
        <PlansSection
          onAction={() => {
            setMode("signup");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
    </div>
  );
}

function LoginForm({ onAuth }: { onAuth: (token: string) => void }) {
  const i18n = useI18n();
  const { t, te } = i18n;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async () => await api.login({ email: email.trim(), password }),
    onSuccess: (res) => {
      if (res.ok) onAuth(res.token);
      else setError(te(res.error));
    },
    onError: () => setError(t("genericError")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-extrabold">{t("loginTitle")}</h2>
      <div>
        <label htmlFor="login-email" className={labelCls}>{t("emailLabel")}</label>
        <input
          {...FIELDS.login.email}
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="login-password" className={labelCls}>{t("passwordLabel")}</label>
        <input
          {...FIELDS.login.password}
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={inputCls}
        />
      </div>
      <ErrorBox message={error} />
      <button type="submit" disabled={login.isPending} className={primaryBtn}>
        {login.isPending ? t("loggingIn") : t("loginTitle")}
      </button>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs font-bold text-[var(--dim)]">{t("or")}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <DiscordButton />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cooldown de renvoi du code : 1 envoi toutes les 30 secondes par adresse.
// Il est gardé dans le navigateur (localStorage), pas seulement dans
// l'écran : il survit au changement d'étape et au rechargement de la page,
// donc impossible de spammer « Recevoir mon code » en naviguant. Le
// serveur applique exactement la même règle de son côté.
// ---------------------------------------------------------------------------

const CODE_COOLDOWN_KEY = "nexora-code-cooldown";

function readCodeCooldown(email: string): number {
  try {
    const raw = localStorage.getItem(CODE_COOLDOWN_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { email?: string; until?: number };
    if (parsed.email !== email.trim().toLowerCase() || !parsed.until) return 0;
    return Math.max(0, Math.ceil((parsed.until - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

function writeCodeCooldown(email: string) {
  try {
    localStorage.setItem(
      CODE_COOLDOWN_KEY,
      JSON.stringify({
        email: email.trim().toLowerCase(),
        until: Date.now() + 30000,
      }),
    );
  } catch {
    // stockage indisponible : le cooldown reste appliqué par le serveur
  }
}

function SignupForm({ onAuth }: { onAuth: (token: string) => void }) {
  const i18n = useI18n();
  const { t, te } = i18n;
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [typedCode, setTypedCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Renvoi du code : 1 fois toutes les 30 secondes. Le compte à rebours
  // est synchronisé avec le cooldown gardé dans le navigateur, pour
  // l'adresse qui a reçu le dernier code : il reste affiché même si on
  // revient à l'étape 1 ou si la page se recharge.
  const [resendLeft, setResendLeft] = useState(0);
  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = setTimeout(() => setResendLeft((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendLeft]);
  useEffect(() => {
    setResendLeft(readCodeCooldown(email));
  }, [email]);

  const delivery = useQuery({
    queryKey: ["code-delivery", email.trim().toLowerCase()],
    queryFn: () => api.getCodeDeliveryStatus({ email: email.trim() }),
    enabled: step === 2,
    refetchInterval: (query) =>
      query.state.data?.status === "envoye" || query.state.data?.status === "echec"
        ? false
        : 3000,
  });
  const deliveryStatus = delivery.data?.status ?? "en_cours";

  const requestCode = useMutation({
    mutationFn: async () => await api.requestSignupCode({ email: email.trim() }),
    onSuccess: (res) => {
      if (res.ok) {
        writeCodeCooldown(email);
        setStep(2);
        setResendLeft(30);
        void queryClient.invalidateQueries({ queryKey: ["code-delivery"] });
      } else {
        // Le serveur a refusé (par exemple le cooldown de 30 s) :
        // on resynchronise le compte à rebours affiché avec lui.
        setResendLeft(readCodeCooldown(email));
        setError(te(res.error));
      }
    },
    onError: () => setError(t("genericError")),
  });

  const register = useMutation({
    mutationFn: async () =>
      await api.register({
        username: username.trim(),
        email: email.trim(),
        password,
        code: typedCode.trim(),
      }),
    onSuccess: (res) => {
      if (res.ok) onAuth(res.token);
      else setError(te(res.error));
    },
    onError: () => setError(t("genericError")),
  });

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    requestCode.mutate();
  }

  function submitDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Même règle que le serveur : pseudo entre 2 et 30 caractères.
    // Vérifié ici pour afficher tout de suite LE message du pseudo,
    // au lieu d'une erreur générique incompréhensible.
    const name = username.trim();
    if (name.length < 2 || name.length > 30) {
      setError(te("Ton pseudo doit faire entre 2 et 30 caractères."));
      return;
    }
    // Même règle que le serveur : 8 à 12 caractères, 1 à 5 chiffres.
    if (password.length < 8 || password.length > 12) {
      setError(te("Le mot de passe doit faire entre 8 et 12 caractères."));
      return;
    }
    const digitCount = (password.match(/[0-9]/g) ?? []).length;
    if (digitCount < 1 || digitCount > 5) {
      setError(te("Le mot de passe doit contenir entre 1 et 5 chiffres."));
      return;
    }
    register.mutate();
  }

  if (step === 1) {
    return (
      <form onSubmit={submitEmail} className="space-y-4">
        <h2 className="text-xl font-extrabold">{t("signupTitle")}</h2>
        <p className="text-sm font-bold text-[var(--dim)]">{t("step1")}</p>
        <div>
          <label htmlFor="signup-email" className={labelCls}>{t("emailLabel")}</label>
          <input
            {...FIELDS.requestSignupCode.email}
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className={inputCls}
          />
        </div>
        <p className="text-sm text-[var(--dim)]">{t("codeIntro")}</p>
        <ErrorBox message={error} />
        <button
          type="submit"
          disabled={requestCode.isPending || resendLeft > 0}
          className={primaryBtn}
        >
          {requestCode.isPending ? t("sending") : t("receiveCode")}
        </button>
        {resendLeft > 0 && (
          <p className="text-center text-sm font-bold text-[var(--dim)]">
            {t("codeCooldownNote", { s: resendLeft })}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submitDetails} className="space-y-4">
      <h2 className="text-xl font-extrabold">{t("signupTitle")}</h2>
      <p className="text-sm font-bold text-[var(--dim)]">{t("step2")}</p>

      {deliveryStatus === "envoye" ? (
        <div className="rounded-xl bg-[#23a55a]/15 px-4 py-3 text-sm">
          <p className="font-bold text-[#3fd68c]">{t("codeSentTitle", { email })}</p>
          <p className="mt-1 text-[var(--dim)]">{t("codeSentBody")}</p>
        </div>
      ) : deliveryStatus === "echec" ? (
        <div className="rounded-xl bg-[#f23f43]/15 px-4 py-3 text-sm">
          <p className="font-bold text-[#ff8589]">{t("codeFailedTitle")}</p>
          <p className="mt-1 text-[var(--dim)]">{t("codeFailedBody")}</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white/10 px-4 py-3 text-sm">
          <p className="font-bold">{t("codeSendingTitle", { email })}</p>
          <p className="mt-1 text-[var(--dim)]">{t("codeSendingBody")}</p>
        </div>
      )}

      <div>
        <label htmlFor="signup-code" className={labelCls}>{t("codeLabel")}</label>
        <input
          {...FIELDS.register.code}
          id="signup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          value={typedCode}
          onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          className={`${inputCls} text-center text-xl font-bold tracking-[0.3em]`}
          aria-describedby="signup-code-spam-hint"
        />
        <p id="signup-code-spam-hint" className="mt-2 text-sm font-medium text-[var(--dim)]">
          {t("codeSpamHint")}
        </p>
      </div>
      <div>
        <label htmlFor="signup-username" className={labelCls}>{t("usernameLabel")}</label>
        <input
          {...FIELDS.register.username}
          id="signup-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("usernamePlaceholder")}
          className={inputCls}
          aria-describedby="signup-username-rule"
        />
        <p id="signup-username-rule" className="mt-1 text-xs text-[var(--dim)]">
          {t("usernameRule")}
        </p>
        {isThiefName(username) && (
          <p className="mt-1 text-sm font-bold text-[#f0b232]">{t("thiefNote")}</p>
        )}
      </div>
      <div>
        <label htmlFor="signup-password" className={labelCls}>{t("passwordNewLabel")}</label>
        <input
          {...FIELDS.register.password}
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={inputCls}
          aria-describedby="signup-password-rule"
        />
        <p id="signup-password-rule" className="mt-1 text-xs text-[var(--dim)]">
          {t("passwordRule")}
        </p>
      </div>
      <ErrorBox message={error} />
      <button
        type="submit"
        disabled={register.isPending || typedCode.length !== 6}
        className={primaryBtn}
      >
        {register.isPending ? t("creating") : t("createSubmit")}
      </button>
      <button
        type="button"
        disabled={requestCode.isPending || resendLeft > 0}
        onClick={() => {
          setError(null);
          requestCode.mutate();
        }}
        className="w-full py-1 text-sm font-bold text-[var(--dim)] underline underline-offset-4 disabled:opacity-50"
      >
        {requestCode.isPending
          ? t("resending")
          : resendLeft > 0
            ? t("resendIn", { s: resendLeft })
            : t("resendCode")}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep(1);
          setError(null);
        }}
        className="w-full py-1 text-sm font-bold text-[var(--dim)] underline underline-offset-4"
      >
        {t("changeEmail")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Écran publicité (activation gratuite du bot)
// ---------------------------------------------------------------------------

function AdScreen({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const finished = left <= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 text-center">
        <p className="text-xs font-bold tracking-widest text-[var(--dim)]">{t("adLabel")}</p>
        <img
          src={botImg}
          alt={t("botAlt")}
          className="mx-auto mt-4 w-36 rounded-full"
        />
        <p className="mt-4 text-xl font-extrabold">{t("adTitle")}</p>
        <p className="mt-2 text-sm text-[var(--dim)]">
          {t("adLine1")}
          <br />
          {t("adLine2")}
          <br />
          {t("adLine3")}
        </p>
        <button
          type="button"
          disabled={!finished}
          onClick={onDone}
          className="mt-5 w-full rounded-xl bg-white px-4 py-3 text-base font-semibold text-black transition hover:bg-[#dcdce0] disabled:bg-[#26262c] disabled:text-[#8b8b93]"
        >
          {finished ? t("adActivate") : t("adWait", { s: left })}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu latéral gauche (une fois connecté) : fermé par défaut, il s'ouvre en
// glissant depuis la gauche quand on appuie sur le bouton en haut à gauche.
// Il contient uniquement les 3 rubriques demandées, en anglais : Contact
// Support / Create your Discord server / Add the Discord bot. La
// déconnexion est un simple bouton icône en bas, sans texte.
// ---------------------------------------------------------------------------

function SideMenu({
  open,
  onClose,
  onSupport,
  onServers,
  onBot,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  onSupport: () => void;
  onServers: () => void;
  onBot: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const itemCls =
    "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-bold text-[var(--text)] transition hover:bg-white/10";
  const iconProps = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;

  const pick = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div dir="ltr" className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/70"
      />
      <aside
        aria-label={t("menu")}
        className="animate-drawer-in absolute inset-y-0 left-0 flex w-80 max-w-[86vw] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <div className="flex items-center gap-2.5">
            <img src={logoImg} alt="" className="h-9 w-9 rounded-full" />
            <span className="text-base font-black tracking-wide">NEXORA</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--dim)] transition hover:bg-white/10 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <nav className="mt-3 flex flex-col gap-1 px-3">
          <button type="button" onClick={pick(onSupport)} className={itemCls}>
            <svg {...iconProps} className="shrink-0 text-[var(--dim)]">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <line x1="4.93" x2="9.17" y1="4.93" y2="9.17" />
              <line x1="14.83" x2="19.07" y1="14.83" y2="19.07" />
              <line x1="14.83" x2="19.07" y1="9.17" y2="4.93" />
              <line x1="4.93" x2="9.17" y1="19.07" y2="14.83" />
            </svg>
            Contact Support
          </button>
          <button type="button" onClick={pick(onServers)} className={itemCls}>
            <svg {...iconProps} className="shrink-0 text-[var(--dim)]">
              <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
              <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
              <line x1="6" x2="6.01" y1="6" y2="6" />
              <line x1="6" x2="6.01" y1="18" y2="18" />
            </svg>
            Create your Discord server
          </button>
          <button type="button" onClick={pick(onBot)} className={itemCls}>
            <svg {...iconProps} className="shrink-0 text-[var(--dim)]">
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
            Add the Discord bot
          </button>
        </nav>

        <div className="mt-auto flex items-center justify-end px-5 pb-6">
          <button
            type="button"
            onClick={onLogout}
            aria-label={t("logout")}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-[var(--dim)] transition hover:bg-white/10 hover:text-white"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
          </button>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran support (lien « Contact Support » du panneau)
// ---------------------------------------------------------------------------

function SupportScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const i18n = useI18n();
  const { t, te } = i18n;
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => await api.sendSupportMessage({ token, message: message.trim() }),
    onSuccess: (res) => {
      if (res.ok) {
        setSent(true);
        setMessage("");
      } else {
        setError(te(res.error));
      }
    },
    onError: () => setError(t("genericError")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSent(false);
    // Message vide ou presque : on dit pourquoi au lieu d'envoyer
    // silencieusement (le serveur exige 3 caractères minimum).
    if (message.trim().length < 3) {
      setError(t("supportEmptyError"));
      return;
    }
    setError(null);
    send.mutate();
  }

  return (
    <div className="mt-5 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="rounded-xl bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text)]"
      >
        ← {t("back")}
      </button>
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <h2 className="text-2xl font-black">{t("supportHeading")}</h2>
        <p className="mt-2 text-sm text-[var(--dim)]">{t("supportIntro")}</p>
        {sent && (
          <p className="mt-4 rounded-xl bg-[#23a55a]/15 px-4 py-3 text-sm font-medium text-[#3fd68c]">
            {t("supportSent")}
          </p>
        )}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="support-message" className={labelCls}>{t("supportLabel")}</label>
            <textarea
              {...FIELDS.sendSupportMessage.message}
              id="support-message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("supportPlaceholder")}
              className={inputCls}
            />
          </div>
          <ErrorBox message={error} />
          <button type="submit" disabled={send.isPending} className={primaryBtn}>
            {send.isPending ? t("sending") : t("supportSend")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section « Tout ce que Sniko Bot sait faire » : les vraies commandes du
// bot (les mêmes que celles qu'il répond sur Discord), groupées par type,
// avec le badge Premium sur celles que les offres payantes débloquent.
// Utilisée sur l'écran d'entrée (avant connexion) et sur l'Accueil.
// ---------------------------------------------------------------------------

const FREE_FEATS: MsgKey[] = [
  "freeFeat1",
  "freeFeat2",
  "freeFeat3",
  "freeFeat4",
  "freeFeat5",
  "freeFeat6",
];

const PREM_FEATS: MsgKey[] = [
  "premFeat1",
  "premFeat2",
  "premFeat3",
  "premFeat4",
  "premFeat5",
  "premFeat6",
];

const COMMAND_GROUPS: {
  titleKey: MsgKey;
  items: { label?: string; descKey: MsgKey; premium?: boolean }[];
}[] = [
  {
    titleKey: "catModeration",
    items: [
      { label: "/ban", descKey: "cmdBan" },
      { label: "/banall", descKey: "cmdBanAll", premium: true },
      { label: "/kick", descKey: "cmdKick" },
      { label: "/mute", descKey: "cmdMute" },
      { label: "/muteall", descKey: "cmdMuteAll", premium: true },
      { label: "/unmute", descKey: "cmdUnmute" },
      { label: "/unmuteall", descKey: "cmdUnmuteAll", premium: true },
      { label: "/warn", descKey: "cmdWarn" },
      { label: "/unwarn", descKey: "cmdUnwarn", premium: true },
      { label: "/clear", descKey: "cmdClear" },
      { label: "/lock", descKey: "cmdLock" },
      { label: "/unlock", descKey: "cmdUnlock" },
      { label: "/slowmode", descKey: "cmdSlowmode", premium: true },
      { label: "/unban", descKey: "cmdUnban" },
    ],
  },
  {
    titleKey: "catCommunity",
    items: [
      { label: "/ticket", descKey: "cmdTicket" },
      { label: "/sondage", descKey: "cmdPoll", premium: true },
      { label: "/giveaway", descKey: "cmdGiveaway", premium: true },
    ],
  },
  {
    titleKey: "catInfos",
    items: [
      { label: "/help", descKey: "cmdHelp" },
      { label: "/userinfo", descKey: "cmdUserinfo" },
      { label: "/serverinfo", descKey: "cmdServerinfo" },
    ],
  },
  {
    titleKey: "catAuto",
    items: [
      { descKey: "featAntiSpam", premium: true },
      { descKey: "featAntiLinks", premium: true },
      { descKey: "featAntiRaid", premium: true },
      { descKey: "featPortal" },
      { descKey: "featWelcome" },
      { descKey: "featBoost" },
    ],
  },
];

function CommandsSection() {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl bg-[var(--surface)] p-5">
      <h2 className="text-2xl font-black">{t("commandsTitle")}</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">{t("commandsIntro")}</p>
      <div className="mt-4 space-y-5">
        {COMMAND_GROUPS.map((group) => (
          <div key={group.titleKey}>
            <h3 className="text-sm font-black uppercase tracking-wide text-[var(--dim)]">
              {t(group.titleKey)}
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <li
                  key={item.descKey}
                  className="rounded-xl bg-[#0a0a0c] px-3.5 py-3"
                >
                  <p className="flex flex-wrap items-center gap-2">
                    {item.label && (
                      <code className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm font-bold text-white">
                        {item.label}
                      </code>
                    )}
                    {item.premium && (
                      <span className="rounded-full bg-[#f0b232] px-2 py-0.5 text-[11px] font-black text-black">
                        {t("premiumTag")}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t(item.descKey)}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section des offres : les 4 formules avec leurs vraies différences.
// `onAction` est appelé au clic sur un bouton d'offre (créer un compte sur
// l'écran d'entrée, aller à l'onglet Bot dans le tableau de bord).
// ---------------------------------------------------------------------------

function PlansSection({
  onAction,
  currentPlan,
}: {
  onAction: () => void;
  currentPlan?: string;
}) {
  const { t } = useI18n();
  const cards: {
    planKey: string;
    name: string;
    price: string;
    periodKey?: MsgKey;
    introKey?: MsgKey;
    feats: MsgKey[];
    highlight?: boolean;
  }[] = [
    { planKey: "gratuit", name: t("planFree"), price: "0 €", feats: FREE_FEATS },
    {
      planKey: "premium",
      name: "Premium",
      price: "3,99 €",
      periodKey: "perMonth",
      feats: PREM_FEATS,
      highlight: true,
    },
    {
      planKey: "premium_plus",
      name: "Premium+",
      price: "10 €",
      periodKey: "per5Months",
      introKey: "plusTag",
      feats: PREM_FEATS,
      highlight: true,
    },
    {
      planKey: "annuel",
      name: t("planAnnual"),
      price: "30 €",
      periodKey: "perYear",
      introKey: "annualTag",
      feats: PREM_FEATS,
      highlight: true,
    },
  ];
  return (
    <section className="rounded-2xl bg-[var(--surface)] p-5">
      <h2 className="text-2xl font-black">{t("plansTitle")}</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">{t("plansIntro")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.name}
            className={`flex flex-col rounded-2xl bg-[#0a0a0c] p-4 ${
              card.highlight ? "ring-1 ring-[#f0b232]" : ""
            }`}
          >
            <p className="text-lg font-extrabold">
              {card.name}
              {card.highlight && <span className="text-[#f0b232]"> ★</span>}
            </p>
            {currentPlan === card.planKey && (
              <p className="mt-1.5">
                <span className="rounded-full bg-[#23a55a] px-2.5 py-1 text-xs font-black text-white">
                  {t("currentPlanTag")}
                </span>
              </p>
            )}
            <p className="mt-1 text-3xl font-black">
              {card.price}
              {card.periodKey && (
                <span className="text-base font-bold text-[var(--dim)]">
                  {" "}
                  {t(card.periodKey)}
                </span>
              )}
            </p>
            {card.introKey && (
              <p className="mt-2 text-sm font-bold text-[#f0b232]">{t(card.introKey)}</p>
            )}
            <ul className="mt-2 flex-1 space-y-1 text-sm text-[var(--dim)]">
              {card.feats.map((f) => (
                <li key={f}>• {t(f)}</li>
              ))}
            </ul>
            <button type="button" onClick={onAction} className={`${primaryBtn} mt-4`}>
              {card.name === t("planFree") ? t("createAccount") : t("seeBot")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord utilisateur
// ---------------------------------------------------------------------------

function BotStatusLine({ bots, now }: { bots: BotItem[]; now: number }) {
  const i18n = useI18n();
  const { t, fmtDate } = i18n;
  const active = bots.find(
    (b) => b.status === "actif" && b.endsAt && new Date(b.endsAt).getTime() > now,
  );
  const pending = bots.find((b) => b.status === "en_attente_paiement");
  if (active && active.endsAt) {
    return (
      <div className="rounded-2xl bg-[#23a55a]/15 px-4 py-3">
        <p className="font-extrabold text-[#3fd68c]">{t("botActiveTitle")}</p>
        <p className="text-sm text-[var(--text)]">
          {t("planLabel")} : {planLabel(active.plan, i18n)}
        </p>
        <p className="text-sm text-[var(--text)]">
          {t("timeLeft")} : {formatRemaining(active.endsAt, now, i18n)}
        </p>
        <p className="text-xs text-[var(--dim)]">
          {t("endsOn", { date: fmtDate(active.endsAt) })}
        </p>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="rounded-2xl bg-[#f0b232]/15 px-4 py-3">
        <p className="font-extrabold text-[#f0b232]">{t("botPendingTitle")}</p>
        <p className="text-sm text-[var(--text)]">
          {t("planLabel")} : {planLabel(pending.plan, i18n)} — {euros(pending.priceCents, i18n)}
        </p>
        <p className="text-sm text-[var(--dim)]">{t("botPendingBody")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
      <p className="font-extrabold">{t("botInactiveTitle")}</p>
      <p className="text-sm text-[var(--dim)]">{t("botInactiveBody")}</p>
    </div>
  );
}

function CurrentPlanChip({ plan, current }: { plan: string; current: string }) {
  const { t } = useI18n();
  if (plan !== current) return null;
  return (
    <p className="mt-2">
      <span className="rounded-full bg-[#23a55a] px-2.5 py-1 text-xs font-black text-white">
        {t("currentPlanTag")}
      </span>
    </p>
  );
}

function Dashboard({ token, user }: { token: string; user: User }) {
  const i18n = useI18n();
  const { t, te, fmtDate } = i18n;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"accueil" | "serveurs" | "bot" | "admin">("accueil");
  const [view, setView] = useState<"main" | "support">("main");
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showAd, setShowAd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Nom du serveur demandé + thème
  const [serverName, setServerName] = useState("");
  const [serverTheme, setServerTheme] = useState("");
  const [serverPlan, setServerPlan] = useState<"demo" | "premium">("demo");
  const [serverNameError, setServerNameError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const mine = useQuery({
    queryKey: ["my-stuff", token],
    queryFn: () => api.getMyStuff({ token }),
  });

  const refreshMine = () => {
    void queryClient.invalidateQueries({ queryKey: ["my-stuff"] });
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  const flash = (msg: string) => {
    setActionError(null);
    setNotice(msg);
  };

  const requestServer = useMutation({
    mutationFn: async () =>
      await api.requestServer({
        token,
        serverName: serverName.trim(),
        plan: serverPlan,
        theme: serverTheme.trim(),
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setServerName("");
        setServerTheme("");
        flash(serverPlan === "premium" ? t("flashServerIncluded") : t("flashServerDemo"));
        refreshMine();
      } else setActionError(te(res.error));
    },
    onError: () => setActionError(t("genericError")),
  });

  const activateFree = useMutation({
    mutationFn: async () => await api.activateBotFree({ token }),
    onSuccess: (res) => {
      setShowAd(false);
      if (res.ok) {
        flash(t("flashBotFree"));
        refreshMine();
      } else setActionError(te(res.error));
    },
    onError: () => {
      setShowAd(false);
      setActionError(t("genericError"));
    },
  });

  const orderBot = useMutation({
    mutationFn: async (plan: "premium" | "premium_plus" | "annuel") =>
      await api.orderBotPlan({ token, plan }),
    onSuccess: (res) => {
      if (res.ok) {
        flash(t("flashBotOrder"));
        refreshMine();
      } else setActionError(te(res.error));
    },
    onError: () => setActionError(t("genericError")),
  });

  const logout = useMutation({
    mutationFn: async () => await api.logout({ token }),
    onSuccess: () => {
      safeRemoveItem(TOKEN_KEY);
      window.location.reload();
    },
  });

  const bots = mine.data?.bots ?? [];
  const servers = mine.data?.servers ?? [];
  const premiumUnlocked = mine.data?.premiumUnlocked ?? false;
  const currentPlan = mine.data?.currentPlan ?? "gratuit";
  const isPatron = user.role === "patron";

  return (
    <div className="w-full px-3 pb-12 sm:px-5 lg:mx-auto lg:max-w-6xl">
      {showAd && (
        <AdScreen seconds={10} onDone={() => activateFree.mutate()} />
      )}

      {/* Barre du haut : bouton du menu en haut à gauche (ouvre le panneau
          latéral gauche), langue en haut à droite */}
      <div dir="ltr" className="flex items-center justify-between gap-3 pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("menu")}
            aria-haspopup="dialog"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] transition hover:bg-[var(--surface-alt)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
            </svg>
          </button>
          <img src={logoImg} alt={t("logoAlt")} className="h-11 w-11 rounded-full" />
          <div>
            <p className="text-lg font-black leading-tight">NEXORA</p>
            <p className="text-sm text-[var(--dim)]">
              {t("hello")}, <span className="font-bold text-white">{displayName(user, i18n)}</span>
              {isPatron && (
                <span className="ml-2 rounded-full bg-[#f0b232] px-2 py-0.5 text-xs font-black text-black">
                  {t("patronBadge")}
                </span>
              )}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-black ${PLAN_BADGE_CLS[currentPlan] ?? "bg-[#33333a] text-white"}`}
              >
                {planLabel(currentPlan, i18n)}
              </span>
            </p>
            {user.discordId && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--dim)]">
                <img
                  src={discordAvatarUrl(user.discordId, user.discordAvatar)}
                  alt=""
                  className="h-5 w-5 rounded-full"
                />
                <span className="font-bold text-white">@{user.discordUsername}</span>
              </p>
            )}
          </div>
        </div>
        <LanguagePicker />
      </div>

      {/* Menu latéral gauche : uniquement les 3 rubriques demandées */}
      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSupport={() => setView("support")}
        onServers={() => {
          setView("main");
          setTab("serveurs");
        }}
        onBot={() => {
          setView("main");
          setTab("bot");
        }}
        onLogout={() => logout.mutate()}
      />

      {/* Navigation principale : un bouton par page, toujours visible en
          haut — Accueil / Créer ton serveur / Ajouter un bot Discord /
          Contacter le support (+ Patron pour le Patron). */}
      <nav className="mt-5 flex flex-wrap gap-2" aria-label={t("sectionsLabel")}>
        {(
          [
            {
              id: "accueil",
              label: t("tabHome"),
              active: view === "main" && tab === "accueil",
              go: () => {
                setView("main");
                setTab("accueil");
              },
            },
            {
              id: "serveurs",
              label: t("navCreateServer"),
              active: view === "main" && tab === "serveurs",
              go: () => {
                setView("main");
                setTab("serveurs");
              },
            },
            {
              id: "bot",
              label: t("navAddBot"),
              active: view === "main" && tab === "bot",
              go: () => {
                setView("main");
                setTab("bot");
              },
            },
            {
              id: "support",
              label: t("navSupport"),
              active: view === "support",
              go: () => setView("support"),
            },
            ...(isPatron
              ? [
                  {
                    id: "admin",
                    label: t("tabAdmin"),
                    active: view === "main" && tab === "admin",
                    go: () => {
                      setView("main");
                      setTab("admin" as const);
                    },
                  },
                ]
              : []),
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.active ? "page" : undefined}
            onClick={item.go}
            className={`flex-1 whitespace-nowrap rounded-xl px-3 py-3 text-sm font-bold ${
              item.active
                ? "bg-white text-black"
                : "bg-[var(--surface)] text-[var(--dim)] hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {view === "support" ? (
        <SupportScreen token={token} onBack={() => setView("main")} />
      ) : (
        <>
          {notice && (
            <p className="mt-4 rounded-xl bg-[#23a55a]/15 px-4 py-3 text-sm font-medium text-[#3fd68c]">
              {notice}
            </p>
          )}
          <ErrorBox message={actionError} />

          {/* ------------------------------ ACCUEIL ------------------------------ */}
          {tab === "accueil" && (
            <div className="mt-5 space-y-4">
              <img
                src={heroImg}
                alt={t("dashHeroAlt")}
                className="w-full rounded-2xl"
              />

              {/* Présentation de sniko bot + accès rapides */}
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <img
                    src={botImg}
                    alt={t("botAlt")}
                    className="w-24 shrink-0 rounded-full"
                  />
                  <div>
                    <h2 className="text-2xl font-black">sniko bot</h2>
                    <p className="mt-1 text-sm text-[var(--dim)]">{t("homeIntro")}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <BotStatusLine bots={bots} now={now} />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setTab("serveurs")}
                    className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#dcdce0]"
                  >
                    {t("navCreateServer")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("bot")}
                    className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#dcdce0]"
                  >
                    {t("navAddBot")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("support")}
                    className="rounded-xl border border-[var(--border)] bg-[#17171b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#202027]"
                  >
                    {t("navSupport")}
                  </button>
                </div>
              </div>

              {/* Ton compte Discord : lié (pseudo + avatar) ou bouton de liaison */}
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <h2 className="text-xl font-extrabold">{t("discordTitle")}</h2>
                {user.discordId ? (
                  <p className="mt-3 flex items-center gap-2.5">
                    <img
                      src={discordAvatarUrl(user.discordId, user.discordAvatar)}
                      alt=""
                      className="h-10 w-10 rounded-full"
                    />
                    <span className="font-bold">@{user.discordUsername}</span>
                    <span className="rounded-full bg-[#23a55a] px-2 py-0.5 text-xs font-black text-white">
                      ✓
                    </span>
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-[var(--dim)]">{t("discordNotLinked")}</p>
                    <div className="mt-3">
                      <DiscordButton token={token} />
                    </div>
                  </>
                )}
                <p className="mt-3 text-sm text-[var(--dim)]">
                  {t("yourPlan")} :{" "}
                  <span className="font-bold text-white">{planLabel(currentPlan, i18n)}</span>
                </p>
              </div>

              <CommandsSection />
              <PlansSection onAction={() => setTab("bot")} currentPlan={currentPlan} />

              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <h2 className="text-xl font-extrabold">{t("homeServerTitle")}</h2>
                <p className="mt-1 text-sm text-[var(--dim)]">{t("homeServerBody")}</p>
                <button type="button" onClick={() => setTab("serveurs")} className={`${primaryBtn} mt-4`}>
                  {t("seeServers")}
                </button>
              </div>
            </div>
          )}

          {/* ----------------------------- SERVEURS ------------------------------ */}
          {tab === "serveurs" && (
            <div className="mt-5 space-y-4">
              <h2 className="text-2xl font-black">{t("serversTitle")}</h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setServerPlan("demo")}
                  aria-pressed={serverPlan === "demo"}
                  className={`rounded-2xl p-5 text-left ${
                    serverPlan === "demo"
                      ? "bg-[var(--surface)] ring-2 ring-white"
                      : "bg-[var(--surface)]"
                  }`}
                >
                  <p className="text-lg font-extrabold">{t("demoOffer")}</p>
                  <p className="mt-1 text-3xl font-black">{t("free")}</p>
                  <ul className="mt-3 space-y-1 text-sm text-[var(--dim)]">
                    <li>• {t("demoF1")}</li>
                    <li>• {t("demoF2")}</li>
                    <li>• {t("demoF3")}</li>
                  </ul>
                  {serverPlan === "demo" && (
                    <p className="mt-3 text-sm font-bold text-[#3fd68c]">{t("chosen")}</p>
                  )}
                </button>
                {premiumUnlocked ? (
                  <button
                    type="button"
                    onClick={() => setServerPlan("premium")}
                    aria-pressed={serverPlan === "premium"}
                    className={`rounded-2xl p-5 text-left ${
                      serverPlan === "premium"
                        ? "bg-[var(--surface)] ring-2 ring-[#f0b232]"
                        : "bg-[var(--surface)]"
                    }`}
                  >
                    <p className="text-lg font-extrabold">
                      {t("premiumOffer")} <span className="text-[#f0b232]">★</span>
                    </p>
                    <p className="mt-1 text-2xl font-black text-[#3fd68c]">
                      {t("serverIncludedBadge")}
                    </p>
                    <ul className="mt-3 space-y-1 text-sm text-[var(--dim)]">
                      <li>• {t("premF1")}</li>
                      <li>• {t("premF2")}</li>
                      <li>• {t("premF3")}</li>
                    </ul>
                    {serverPlan === "premium" && (
                      <p className="mt-3 text-sm font-bold text-[#3fd68c]">{t("chosen")}</p>
                    )}
                  </button>
                ) : (
                  <div className="rounded-2xl bg-[var(--surface)] p-5 opacity-90">
                    <p className="flex items-center gap-2 text-lg font-extrabold">
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[#f0b232]">
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      {t("serverLockedTitle")} <span className="text-[#f0b232]">★</span>
                    </p>
                    <p className="mt-2 text-sm text-[var(--dim)]">{t("serverLockedBody")}</p>
                    <button
                      type="button"
                      onClick={() => setTab("bot")}
                      className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#dcdce0]"
                    >
                      {t("seePlansBtn")}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Nom trop court : on dit pourquoi à côté du champ au
                  // lieu de ne rien envoyer en silence (le serveur exige
                  // 2 caractères minimum).
                  if (serverName.trim().length < 2) {
                    setServerNameError(t("serverNameError"));
                    return;
                  }
                  setServerNameError(null);
                  setNotice(null);
                  requestServer.mutate();
                }}
                className="space-y-4 rounded-2xl bg-[var(--surface)] p-5"
              >
                <h3 className="text-lg font-extrabold">{t("requestTitle")}</h3>
                <div>
                  <label htmlFor="server-name" className={labelCls}>{t("serverNameLabel")}</label>
                  <input
                    {...FIELDS.requestServer.serverName}
                    id="server-name"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder={t("serverNamePlaceholder")}
                    className={inputCls}
                    aria-describedby={serverNameError ? "server-name-error" : undefined}
                  />
                  {serverNameError && (
                    <p id="server-name-error" role="alert" className="mt-1.5 text-sm font-medium text-[#ff8589]">
                      {serverNameError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="server-theme" className={labelCls}>{t("themeLabel")}</label>
                  <input
                    {...FIELDS.requestServer.theme}
                    id="server-theme"
                    value={serverTheme}
                    onChange={(e) => setServerTheme(e.target.value)}
                    placeholder={t("themePlaceholder")}
                    className={inputCls}
                  />
                </div>
                <p className="text-sm text-[var(--dim)]">
                  {serverPlan === "premium" ? t("premiumNote") : t("demoNote")}
                </p>
                <button type="submit" disabled={requestServer.isPending} className={primaryBtn}>
                  {requestServer.isPending
                    ? t("sending")
                    : serverPlan === "premium"
                      ? t("orderServerPremium")
                      : t("requestServerDemo")}
                </button>
              </form>

              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <h3 className="text-lg font-extrabold">{t("myServers")}</h3>
                {mine.isPending ? (
                  <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
                ) : servers.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--dim)]">{t("noServers")}</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {servers.map((s) => {
                      const labelKey = SERVER_STATUS_KEY[s.status] ?? "statusQueued";
                      const cls = SERVER_STATUS_CLS[s.status] ?? SERVER_STATUS_CLS.en_attente!;
                      return (
                        <li key={s.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-bold">{s.serverName}</p>
                            <Badge text={t(labelKey)} cls={cls} />
                          </div>
                          <p className="mt-1 text-sm text-[var(--dim)]">
                            {s.plan === "premium" ? t("planPremiumName") : t("planDemoName")} —{" "}
                            {euros(s.priceCents, i18n)} — {t("requestedOn", { date: fmtDate(s.createdAt) })}
                          </p>
                          {s.theme && (
                            <p className="text-sm text-[var(--dim)]">{t("themeLine", { theme: s.theme })}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              </div>
            </div>
          )}

          {/* -------------------------------- BOT -------------------------------- */}
          {tab === "bot" && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-[var(--surface)] p-5 text-center">
                <img
                  src={botImg}
                  alt={t("botAlt")}
                  className="mx-auto w-32 rounded-full"
                />
                <h2 className="mt-3 text-2xl font-black">sniko bot</h2>
                <p className="mt-1 text-sm text-[var(--dim)]">{t("botTagline")}</p>
                <div className="mt-4 text-left">
                  <BotStatusLine bots={bots} now={now} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col rounded-2xl bg-[var(--surface)] p-5">
                <h3 className="text-lg font-extrabold">{t("freeOfferTitle")}</h3>
                <p className="mt-1 text-3xl font-black">0 €</p>
                <CurrentPlanChip plan="gratuit" current={currentPlan} />
                <ul className="mt-2 flex-1 space-y-1 text-sm text-[var(--dim)]">
                  {FREE_FEATS.map((f) => (
                    <li key={f}>• {t(f)}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setActionError(null);
                    setShowAd(true);
                  }}
                  className={`${greenBtn} mt-4`}
                >
                  {t("watchAd")}
                </button>
              </div>

              <div className="flex flex-col rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[#f0b232]">
                <h3 className="text-lg font-extrabold">
                  Premium <span className="text-[#f0b232]">★</span>
                </h3>
                <p className="mt-1 text-3xl font-black">
                  3,99 €{" "}
                  <span className="text-base font-bold text-[var(--dim)]">{t("perMonth")}</span>
                </p>
                <CurrentPlanChip plan="premium" current={currentPlan} />
                <ul className="mt-2 flex-1 space-y-1 text-sm text-[var(--dim)]">
                  {PREM_FEATS.map((f) => (
                    <li key={f}>• {t(f)}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={orderBot.isPending}
                  onClick={() => orderBot.mutate("premium")}
                  className={`${primaryBtn} mt-4`}
                >
                  {t("orderPremium")}
                </button>
              </div>

              <div className="flex flex-col rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[#f0b232]">
                <h3 className="text-lg font-extrabold">
                  Premium+ <span className="text-[#f0b232]">★★</span>
                </h3>
                <p className="mt-1 text-3xl font-black">
                  10 €{" "}
                  <span className="text-base font-bold text-[var(--dim)]">{t("per5Months")}</span>
                </p>
                <CurrentPlanChip plan="premium_plus" current={currentPlan} />
                <p className="mt-2 text-sm font-bold text-[#f0b232]">{t("plusTag")}</p>
                <ul className="mt-2 flex-1 space-y-1 text-sm text-[var(--dim)]">
                  {PREM_FEATS.map((f) => (
                    <li key={f}>• {t(f)}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={orderBot.isPending}
                  onClick={() => orderBot.mutate("premium_plus")}
                  className={`${primaryBtn} mt-4`}
                >
                  {t("orderPremiumPlus")}
                </button>
              </div>

              <div className="flex flex-col rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-[#f0b232]">
                <h3 className="text-lg font-extrabold">
                  {t("planAnnual")} <span className="text-[#f0b232]">★★★</span>
                </h3>
                <p className="mt-1 text-3xl font-black">
                  30 €{" "}
                  <span className="text-base font-bold text-[var(--dim)]">{t("perYear")}</span>
                </p>
                <CurrentPlanChip plan="annuel" current={currentPlan} />
                <p className="mt-2 text-sm font-bold text-[#f0b232]">{t("annualTag")}</p>
                <ul className="mt-2 flex-1 space-y-1 text-sm text-[var(--dim)]">
                  {PREM_FEATS.map((f) => (
                    <li key={f}>• {t(f)}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={orderBot.isPending}
                  onClick={() => orderBot.mutate("annuel")}
                  className={`${primaryBtn} mt-4`}
                >
                  {t("orderAnnual")}
                </button>
              </div>
              </div>

              <p className="px-1 text-sm text-[var(--dim)]">{t("paidNote")}</p>

              {bots.length > 0 && (
                <div className="rounded-2xl bg-[var(--surface)] p-5">
                  <h3 className="text-lg font-extrabold">{t("botHistory")}</h3>
                  <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                    {bots.map((b) => (
                      <li key={b.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold">{planLabel(b.plan, i18n)}</p>
                          {b.status === "actif" && b.endsAt && new Date(b.endsAt).getTime() > now ? (
                            <Badge text={t("statusActive")} cls="bg-[#23a55a] text-white" />
                          ) : b.status === "en_attente_paiement" ? (
                            <Badge text={t("statusPendingPayment")} cls="bg-[#f0b232] text-black" />
                          ) : b.status === "annule" ? (
                            <Badge text={t("statusCancelled")} cls="bg-[#f23f43] text-white" />
                          ) : (
                            <Badge text={t("statusExpired")} cls="bg-[#3f4147] text-white" />
                          )}
                        </div>
                        <p className="mt-1 text-sm text-[var(--dim)]">
                          {euros(b.priceCents, i18n)} — {t("orderedOn", { date: fmtDate(b.createdAt) })}
                          {b.endsAt && b.status === "actif"
                            ? ` — ${t("endsOnShort", { date: fmtDate(b.endsAt) })}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------- ADMIN ------------------------------- */}
          {tab === "admin" && isPatron && <AdminPanel token={token} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord Patron
// ---------------------------------------------------------------------------

// Sélecteur d'offre dans la liste des utilisateurs du Patron : choisir
// une offre puis « Définir l'offre » l'active tout de suite pour
// l'utilisateur (attribution manuelle, aucun paiement branché).
function AdminUserPlanForm({
  userId,
  current,
  disabled,
  onApply,
}: {
  userId: number;
  current: string;
  disabled: boolean;
  onApply: (plan: "gratuit" | "premium" | "premium_plus" | "annuel") => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [plan, setPlan] = useState(current);
  useEffect(() => {
    setPlan(current);
  }, [current]);
  const plans: ("gratuit" | "premium" | "premium_plus" | "annuel")[] = [
    "gratuit",
    "premium",
    "premium_plus",
    "annuel",
  ];
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <label htmlFor={`admin-plan-${userId}`} className="text-sm font-bold text-[var(--dim)]">
        {t("planLabel")}
      </label>
      <select
        id={`admin-plan-${userId}`}
        value={plan}
        onChange={(e) =>
          setPlan(e.target.value as "gratuit" | "premium" | "premium_plus" | "annuel")
        }
        className="rounded-lg border border-[var(--border)] bg-[#0a0a0c] px-3 py-2 text-sm font-bold text-[var(--text)]"
      >
        {plans.map((p) => (
          <option key={p} value={p}>
            {planLabel(p, i18n)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled || plan === current}
        onClick={() =>
          onApply(plan as "gratuit" | "premium" | "premium_plus" | "annuel")
        }
        className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
      >
        {t("adminPlanSet")}
      </button>
    </div>
  );
}

// Section Patron « Connexion Discord (OAuth) » + « API du bot » :
// enregistre le Client Secret Discord, l'adresse de retour et la clé
// API du bot (action adminSaveDiscordConfig). Les variables
// d'environnement (DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI,
// NEXORA_API_KEY) sont prioritaires quand elles existent ; le secret et
// la clé ne sont JAMAIS réaffichés (l'action adminGetDiscordConfig dit
// seulement s'ils sont enregistrés).
function AdminDiscordConfig({ token }: { token: string }) {
  const i18n = useI18n();
  const { t, te } = i18n;
  const queryClient = useQueryClient();
  const [redirectUri, setRedirectUri] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialized = useRef(false);

  const config = useQuery({
    queryKey: ["admin", "discord-config", token],
    queryFn: () => api.adminGetDiscordConfig({ token }),
  });

  // Pré-remplissage : l'adresse enregistrée, ou l'adresse de cette page
  // (c'est elle que Discord doit rappeler après l'autorisation).
  useEffect(() => {
    if (!config.data?.allowed || initialized.current) return;
    initialized.current = true;
    setRedirectUri(
      config.data.redirectUri ||
        window.location.href.split(/[?#]/)[0] ||
        "",
    );
  }, [config.data]);

  const save = useMutation({
    mutationFn: async () =>
      await api.adminSaveDiscordConfig({
        token,
        redirectUri: redirectUri.trim(),
        clientSecret: clientSecret.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setSaved(true);
        setClientSecret("");
        setApiKey("");
        void queryClient.invalidateQueries({ queryKey: ["admin", "discord-config"] });
      } else {
        setSaved(false);
        setError(te(res.error));
      }
    },
    onError: () => setError(t("genericError")),
  });

  const d = config.data;
  const statusLine = (isSet: boolean, fromEnv: boolean, setKey: MsgKey, missingKey: MsgKey) => (
    <p className={`mt-1 text-sm font-bold ${isSet ? "text-[#3fd68c]" : "text-[#f0b232]"}`}>
      {t(isSet ? setKey : missingKey)}
      {fromEnv && (
        <span className="block text-xs font-medium text-[var(--dim)]">
          {t("adminDiscordEnvNote")}
        </span>
      )}
    </p>
  );

  return (
    <div className="rounded-2xl bg-[var(--surface)] p-5">
      <h3 className="text-lg font-extrabold">{t("adminDiscordTitle")}</h3>
      <p className="mt-2 text-sm text-[var(--dim)]">{t("adminDiscordIntro")}</p>
      {config.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">{t("loading")}</p>
      ) : d?.allowed ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setSaved(false);
            save.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <div>
            <span className={labelCls}>{t("adminDiscordClientId")}</span>
            <p className="rounded-xl border border-[var(--border)] bg-[#0a0a0c] px-4 py-3 font-mono text-sm text-[var(--dim)]">
              {d.clientId}
            </p>
          </div>
          <div>
            <label htmlFor="discord-redirect" className={labelCls}>
              {t("adminDiscordRedirect")}
            </label>
            <input
              {...FIELDS.adminSaveDiscordConfig.redirectUri}
              id="discord-redirect"
              type="url"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[var(--dim)]">{t("adminDiscordRedirectHelp")}</p>
            {d.redirectFromEnv && (
              <p className="mt-1 text-xs font-bold text-[#3fd68c]">{t("adminDiscordEnvNote")}</p>
            )}
          </div>
          <div>
            <label htmlFor="discord-secret" className={labelCls}>
              {t("adminDiscordSecret")}
            </label>
            <input
              {...FIELDS.adminSaveDiscordConfig.clientSecret}
              id="discord-secret"
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className={inputCls}
            />
            {statusLine(d.secretSet, d.secretFromEnv, "adminDiscordSecretSet", "adminDiscordSecretMissing")}
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h4 className="text-base font-extrabold">{t("adminApiTitle")}</h4>
            <p className="mt-1 text-sm text-[var(--dim)]">{t("adminApiIntro")}</p>
            <div className="mt-3">
              <label htmlFor="nexora-api-key" className={labelCls}>
                {t("adminApiKey")}
              </label>
              <input
                {...FIELDS.adminSaveDiscordConfig.apiKey}
                id="nexora-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••••••"
                className={inputCls}
              />
              {statusLine(d.apiKeySet, d.apiKeyFromEnv, "adminApiKeySet", "adminApiKeyMissing")}
            </div>
          </div>

          <ErrorBox message={error} />
          {saved && (
            <p className="rounded-xl bg-[#23a55a]/15 px-4 py-3 text-sm font-medium text-[#3fd68c]">
              {t("adminDiscordSaved")}
            </p>
          )}
          <button type="submit" disabled={save.isPending} className={primaryBtn}>
            {save.isPending ? t("sending") : t("adminDiscordSave")}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-[var(--dim)]">{t("actionRefused")}</p>
      )}
    </div>
  );
}

// Section Patron « Base de données » : dit si DATABASE_URL (Supabase)
// est détectée dans l'environnement et si la base répond. L'URL n'est
// jamais affichée. Sans DATABASE_URL, la base locale de la plateforme
// est utilisée (développement) — le message le dit clairement.
function AdminDatabaseStatus({ token }: { token: string }) {
  const { t } = useI18n();
  const status = useQuery({
    queryKey: ["admin", "db-status", token],
    queryFn: () => api.adminGetDatabaseStatus({ token }),
  });
  const d = status.data;
  return (
    <div className="rounded-2xl bg-[var(--surface)] p-5">
      <h3 className="text-lg font-extrabold">{t("adminDbTitle")}</h3>
      {status.isPending || !d ? (
        <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
      ) : !d.databaseUrlSet ? (
        <p className="mt-2 text-sm text-[var(--dim)]">{t("adminDbLocal")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-bold text-white">{t("adminDbSet")}</p>
          <p
            className={`mt-1 text-sm font-bold ${d.reachable ? "text-[#3fd68c]" : "text-[#f0b232]"}`}
          >
            {d.reachable ? t("adminDbReachable") : t("adminDbUnreachable")}
          </p>
        </>
      )}
    </div>
  );
}

function AdminPanel({ token }: { token: string }) {
  const i18n = useI18n();
  const { t, te, fmtDate } = i18n;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["admin", "overview", token],
    queryFn: () => api.adminOverview({ token }),
  });
  const users = useQuery({
    queryKey: ["admin", "users", token],
    queryFn: () => api.adminListUsers({ token }),
  });
  const servers = useQuery({
    queryKey: ["admin", "servers", token],
    queryFn: () => api.adminListServers({ token }),
  });
  const bots = useQuery({
    queryKey: ["admin", "bots", token],
    queryFn: () => api.adminListBots({ token }),
  });
  const support = useQuery({
    queryKey: ["admin", "support", token],
    queryFn: () => api.adminListSupportMessages({ token }),
  });

  const refreshAdmin = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    void queryClient.invalidateQueries({ queryKey: ["my-stuff"] });
  };

  const wrap = (fn: () => Promise<{ ok: boolean; error?: string }>) => async () => {
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(te(res.error ?? t("actionRefused")));
      refreshAdmin();
    } catch {
      setError(t("genericError"));
    }
  };

  const validateServer = useMutation({
    mutationFn: async (id: number) =>
      await wrap(() => api.adminValidateServerPayment({ token, id }))(),
  });
  const setServerStatus = useMutation({
    mutationFn: async (v: { id: number; status: "en_cours" | "termine" | "annule" }) =>
      await wrap(() => api.adminSetServerStatus({ token, id: v.id, status: v.status }))(),
  });
  const validateBot = useMutation({
    mutationFn: async (id: number) =>
      await wrap(() => api.adminValidateBotPayment({ token, id }))(),
  });
  const cancelBot = useMutation({
    mutationFn: async (id: number) =>
      await wrap(() => api.adminCancelBot({ token, id }))(),
  });
  const setRole = useMutation({
    mutationFn: async (v: { userId: number; role: "membre" | "patron" }) =>
      await wrap(() => api.adminSetRole({ token, userId: v.userId, role: v.role }))(),
  });
  const setUserPlan = useMutation({
    mutationFn: async (v: {
      userId: number;
      plan: "gratuit" | "premium" | "premium_plus" | "annuel";
    }) =>
      await wrap(() =>
        api.adminSetUserPlan({ token, userId: v.userId, plan: v.plan }),
      )(),
  });
  const handleSupport = useMutation({
    mutationFn: async (v: { id: number; status: "nouveau" | "traite" }) =>
      await wrap(() => api.adminHandleSupportMessage({ token, id: v.id, status: v.status }))(),
  });

  const ov = overview.data;
  const smallBtn =
    "rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50";

  return (
    <div className="mt-5 space-y-4">
      <h2 className="text-2xl font-black">
        {t("adminDashboard")} <span className="text-[#f0b232]">{t("patronWord")}</span>
      </h2>
      <ErrorBox message={error} />

      {ov && ov.allowed && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: t("statUsers"), value: String(ov.users) },
            { label: t("statServersTotal"), value: String(ov.serversTotal) },
            { label: t("statServersPending"), value: String(ov.serversPending) },
            { label: t("statBotsActive"), value: String(ov.botsActive) },
            { label: t("statBotsPending"), value: String(ov.botsPending) },
            { label: t("statRevenue"), value: `${(ov.revenueCents / 100).toFixed(0)} €` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-[var(--surface)] px-4 py-3">
              <p className="text-2xl font-black">{s.value}</p>
              <p className="text-xs font-bold text-[var(--dim)]">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Utilisateurs */}
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <h3 className="text-lg font-extrabold">{t("adminUsersTitle")}</h3>
        {users.isPending ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
        ) : (users.data?.users.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("adminNoUsers")}</p>
        ) : (
          <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {users.data?.users.map((u) => (
              <li key={u.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {displayName(u, i18n)}
                    {u.role === "patron" && (
                      <span className="ml-2 rounded-full bg-[#f0b232] px-2 py-0.5 text-xs font-black text-black">
                        {t("patronBadge")}
                      </span>
                    )}
                  </p>
                  {u.role === "patron" ? (
                    <button
                      type="button"
                      disabled={setRole.isPending}
                      onClick={() => setRole.mutate({ userId: u.id, role: "membre" })}
                      className={`${smallBtn} bg-[#3f4147]`}
                    >
                      {t("removePatron")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={setRole.isPending}
                      onClick={() => setRole.mutate({ userId: u.id, role: "patron" })}
                      className={`${smallBtn} bg-[#f0b232] !text-black`}
                    >
                      {t("givePatron")}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {u.email} — {t("registeredOn", { date: fmtDate(u.createdAt) })}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[var(--dim)]">
                  <span>
                    {t("yourPlan")} :{" "}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${PLAN_BADGE_CLS[u.currentPlan] ?? "bg-[#33333a] text-white"}`}
                    >
                      {planLabel(u.currentPlan, i18n)}
                    </span>
                  </span>
                  {u.discordId && (
                    <span className="flex items-center gap-1.5">
                      <img
                        src={discordAvatarUrl(u.discordId, u.discordAvatar)}
                        alt=""
                        className="h-4 w-4 rounded-full"
                      />
                      <span className="font-bold text-white">@{u.discordUsername}</span>
                    </span>
                  )}
                </p>
                <AdminUserPlanForm
                  userId={u.id}
                  current={u.currentPlan}
                  disabled={setUserPlan.isPending}
                  onApply={(plan) => setUserPlan.mutate({ userId: u.id, plan })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Serveurs */}
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <h3 className="text-lg font-extrabold">{t("adminServersTitle")}</h3>
        {servers.isPending ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
        ) : (servers.data?.servers.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("adminNoServers")}</p>
        ) : (
          <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {servers.data?.servers.map((s: AdminServer) => {
              const labelKey = SERVER_STATUS_KEY[s.status] ?? "statusQueued";
              const cls = SERVER_STATUS_CLS[s.status] ?? SERVER_STATUS_CLS.en_attente!;
              return (
                <li key={s.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">{s.serverName}</p>
                    <Badge text={t(labelKey)} cls={cls} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--dim)]">
                    {t("forOwner", { name: s.ownerName })} —{" "}
                    {s.plan === "premium" ? t("planPremiumName") : t("planDemoName")} —{" "}
                    {euros(s.priceCents, i18n)} — {fmtDate(s.createdAt)}
                  </p>
                  {s.theme && (
                    <p className="text-sm text-[var(--dim)]">{t("themeLine", { theme: s.theme })}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.status === "en_attente_paiement" && (
                      <button
                        type="button"
                        disabled={validateServer.isPending}
                        onClick={() => validateServer.mutate(s.id)}
                        className={`${smallBtn} bg-white !text-black`}
                      >
                        {t("validateServerPay")}
                      </button>
                    )}
                    {(s.status === "en_attente" || s.status === "en_cours") && (
                      <>
                        {s.status === "en_attente" && (
                          <button
                            type="button"
                            disabled={setServerStatus.isPending}
                            onClick={() =>
                              setServerStatus.mutate({ id: s.id, status: "en_cours" })
                            }
                            className={`${smallBtn} bg-[#33333a]`}
                          >
                            {t("markBuilding")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={setServerStatus.isPending}
                          onClick={() =>
                            setServerStatus.mutate({ id: s.id, status: "termine" })
                          }
                          className={`${smallBtn} bg-white !text-black`}
                        >
                          {t("markDone")}
                        </button>
                      </>
                    )}
                    {s.status !== "annule" && s.status !== "termine" && (
                      <button
                        type="button"
                        disabled={setServerStatus.isPending}
                        onClick={() =>
                          setServerStatus.mutate({ id: s.id, status: "annule" })
                        }
                        className={`${smallBtn} bg-[#f23f43]`}
                      >
                        {t("cancel")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bots */}
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <h3 className="text-lg font-extrabold">{t("adminBotsTitle")}</h3>
        {bots.isPending ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
        ) : (bots.data?.bots.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("adminNoBots")}</p>
        ) : (
          <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {bots.data?.bots.map((b: AdminBot) => (
              <li key={b.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {b.ownerName} — {planLabel(b.plan, i18n)}
                  </p>
                  {b.status === "en_attente_paiement" ? (
                    <Badge text={t("statusPendingPayment")} cls="bg-[#f0b232] text-black" />
                  ) : b.status === "annule" ? (
                    <Badge text={t("statusCancelled")} cls="bg-[#f23f43] text-white" />
                  ) : b.status === "actif" ? (
                    <Badge text={t("statusActive")} cls="bg-[#23a55a] text-white" />
                  ) : (
                    <Badge text={t("statusExpired")} cls="bg-[#3f4147] text-white" />
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {euros(b.priceCents, i18n)} — {t("orderedOn", { date: fmtDate(b.createdAt) })}
                  {b.endsAt ? ` — ${t("endsOnShort", { date: fmtDate(b.endsAt) })}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {b.status === "en_attente_paiement" && (
                    <button
                      type="button"
                      disabled={validateBot.isPending}
                      onClick={() => validateBot.mutate(b.id)}
                      className={`${smallBtn} bg-white !text-black`}
                    >
                      {t("validateBotPay", { price: euros(b.priceCents, i18n) })}
                    </button>
                  )}
                  {b.status !== "annule" && (
                    <button
                      type="button"
                      disabled={cancelBot.isPending}
                      onClick={() => cancelBot.mutate(b.id)}
                      className={`${smallBtn} bg-[#f23f43]`}
                    >
                      {t("cutBot")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Messages du support */}
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <h3 className="text-lg font-extrabold">{t("adminSupportTitle")}</h3>
        {support.isPending ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("loading")}</p>
        ) : (support.data?.messages.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">{t("adminNoSupport")}</p>
        ) : (
          <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {support.data?.messages.map((m: AdminSupport) => (
              <li key={m.id} className="rounded-2xl bg-[#0a0a0c] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{m.ownerName}</p>
                  {m.status === "traite" ? (
                    <Badge text={t("supportStatusDone")} cls="bg-[#23a55a] text-white" />
                  ) : (
                    <Badge text={t("supportStatusNew")} cls="bg-[#f0b232] text-black" />
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{m.message}</p>
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {m.ownerEmail} — {fmtDate(m.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.status === "nouveau" ? (
                    <button
                      type="button"
                      disabled={handleSupport.isPending}
                      onClick={() => handleSupport.mutate({ id: m.id, status: "traite" })}
                      className={`${smallBtn} bg-white !text-black`}
                    >
                      {t("markHandled")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={handleSupport.isPending}
                      onClick={() => handleSupport.mutate({ id: m.id, status: "nouveau" })}
                      className={`${smallBtn} bg-[#3f4147]`}
                    >
                      {t("reopen")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Connexion Discord + API du bot, puis statut base de données */}
      <AdminDiscordConfig token={token} />
      <AdminDatabaseStatus token={token} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Racine
// ---------------------------------------------------------------------------

function Root() {
  const { dir, t, te } = useI18n();
  const [token, setToken] = useState<string | null>(() => safeGetItem(TOKEN_KEY));
  // Retour OAuth Discord : liaison en attente de confirmation, erreur ou
  // confirmation à afficher au-dessus de l'écran courant.
  const [discordPending, setDiscordPending] = useState<{
    pendingToken: string;
    discordUsername: string;
  } | null>(null);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordNotice, setDiscordNotice] = useState<string | null>(null);
  const discordHandled = useRef(false);

  // Favicon du site : le logo NEXORA fourni par sniko.
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = logoImg;
  }, []);

  // Retour OAuth Discord : Discord renvoie l'utilisateur sur l'adresse
  // de retour enregistrée avec ?code=&state= dans l'adresse. On lit ces
  // paramètres UNE fois, on nettoie l'adresse, puis le serveur échange
  // le code (completeDiscordLogin) : connexion directe si ce Discord
  // est déjà lié, sinon carte de confirmation explicite avant liaison.
  useEffect(() => {
    if (discordHandled.current) return;
    discordHandled.current = true;
    let code: string | null = null;
    let state: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      code = params.get("code");
      state = params.get("state");
    } catch {
      return;
    }
    if (!code || !state) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // Adresse illisible : on tente quand même l'échange du code.
    }
    void (async () => {
      try {
        const res = await api.completeDiscordLogin({ code, state });
        if (!res.ok) {
          setDiscordError(te(res.error));
        } else if (res.kind === "login") {
          handleAuth(res.token);
        } else {
          setDiscordPending({
            pendingToken: res.pendingToken,
            discordUsername: res.discordUsername,
          });
        }
      } catch {
        setDiscordError(t("discordFailed"));
      }
    })();
    // Une seule exécution, au premier affichage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = useQuery({
    queryKey: ["session", token],
    queryFn: () => api.getSession({ token: token ?? "" }),
    enabled: !!token,
    // Un seul réessai : si le serveur ne répond pas (connexion du
    // téléphone coupée, VPN/proxy qui bloque), on sort vite de l'écran
    // de chargement au lieu d'attendre les réessais par défaut.
    retry: 1,
  });

  const user = session.data?.user ?? null;

  useEffect(() => {
    if (token && session.isSuccess && !session.data.user) {
      safeRemoveItem(TOKEN_KEY);
      setToken(null);
    }
  }, [token, session.isSuccess, session.data]);

  // Auto-réparation : si la vérification de la session ÉCHOUE (le serveur
  // n'a pas répondu), le jeton gardé sur le téléphone peut être inutilisable
  // et l'app restait bloquée entre l'écran de chargement et rien du tout —
  // l'utilisateur ne voyait qu'une page noire. On oublie ce jeton et on
  // revient à l'écran de connexion, qui marche toujours.
  useEffect(() => {
    if (token && session.isError) {
      safeRemoveItem(TOKEN_KEY);
      setToken(null);
    }
  }, [token, session.isError]);

  function handleAuth(newToken: string) {
    safeSetItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }

  // Confirmation explicite de la liaison Discord : rien n'est lié tant
  // que l'utilisateur n'a pas touché « Oui, connecter ». Si personne
  // n'est connecté, le serveur refuse et la carte reste ouverte : il
  // suffit de se connecter dessous, puis de confirmer à nouveau.
  const confirmLink = useMutation({
    mutationFn: async () =>
      await api.confirmDiscordLink({
        pendingToken: discordPending?.pendingToken ?? "",
        token: token ?? undefined,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setDiscordPending(null);
        setDiscordError(null);
        setDiscordNotice(t("discordLinkDone"));
        handleAuth(res.token);
      } else {
        setDiscordError(te(res.error));
      }
    },
    onError: () => setDiscordError(t("genericError")),
  });

  const cancelLink = useMutation({
    mutationFn: async () =>
      await api.cancelDiscordLink({
        pendingToken: discordPending?.pendingToken ?? "",
      }),
    onSuccess: () => {
      setDiscordPending(null);
      setDiscordError(null);
    },
    onError: () => setDiscordPending(null),
  });

  return (
    <div dir={dir} className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      {discordNotice && (
        <div className="mx-auto w-full max-w-xl px-3 pt-4">
          <p className="rounded-xl bg-[#23a55a]/15 px-4 py-3 text-sm font-medium text-[#3fd68c]">
            {discordNotice}
          </p>
        </div>
      )}
      {discordError && !discordPending && (
        <div className="mx-auto w-full max-w-xl px-3 pt-4">
          <ErrorBox message={discordError} />
        </div>
      )}

      {/* Carte de confirmation de liaison Discord (retour OAuth) */}
      {discordPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("discordConfirmTitle")}
            className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 text-center"
          >
            <h2 className="text-xl font-extrabold">{t("discordConfirmTitle")}</h2>
            <p className="mt-3 font-bold">
              {t("discordConfirmAccount", { name: discordPending.discordUsername })}
            </p>
            <p className="mt-2 text-sm text-[var(--dim)]">{t("discordConfirmBody")}</p>
            {discordError && (
              <div className="mt-4 text-left">
                <ErrorBox message={discordError} />
              </div>
            )}
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                disabled={confirmLink.isPending}
                onClick={() => {
                  setDiscordError(null);
                  confirmLink.mutate();
                }}
                className={primaryBtn}
              >
                {t("discordConfirmYes")}
              </button>
              <button
                type="button"
                disabled={cancelLink.isPending}
                onClick={() => cancelLink.mutate()}
                className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-base font-semibold text-white transition hover:bg-white/10"
              >
                {t("discordConfirmNo")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!token ? (
        <EntryScreen onAuth={handleAuth} />
      ) : session.isPending ? (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <img src={logoImg} alt="" className="h-20 w-20 rounded-full" />
          <p className="text-base font-bold text-white">{t("loading")}</p>
          {/* Sortie de secours toujours visible : si le chargement reste
              bloqué (connexion du téléphone, jeton inutilisable), un
              toucher ramène à l'écran de connexion au lieu de rester
              devant une page presque noire sans rien pouvoir faire. */}
          <button
            type="button"
            onClick={() => {
              safeRemoveItem(TOKEN_KEY);
              setToken(null);
            }}
            className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-base font-semibold text-white transition hover:bg-[var(--surface-alt)]"
          >
            {t("backToLogin")}
          </button>
        </div>
      ) : user ? (
        <Dashboard token={token} user={user} />
      ) : (
        <EntryScreen onAuth={handleAuth} />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Filet de sécurité : si un affichage plante malgré tout, l'utilisateur voit
// un message clair avec un bouton pour revenir à l'écran de connexion —
// jamais un écran noir sans explication ni moyen d'en sortir. Le texte est
// écrit en dur (anglais + français) pour s'afficher même si le reste de
// l'app n'a pas pu démarrer.
// ---------------------------------------------------------------------------

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  override render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <img src={logoImg} alt="" className="h-20 w-20 rounded-full" />
        <p className="text-xl font-black">NEXORA</p>
        <p className="max-w-sm text-sm text-[#a7a7ae]">
          Something went wrong while loading the page. / Un problème est
          survenu pendant le chargement de la page.
        </p>
        <button
          type="button"
          onClick={() => {
            safeRemoveItem(TOKEN_KEY);
            window.location.reload();
          }}
          className="rounded-xl bg-white px-5 py-3 text-base font-semibold text-black"
        >
          Back to login / Retour à la connexion
        </button>
      </div>
    );
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <I18nProvider>
        <Root />
      </I18nProvider>
    </AppErrorBoundary>
  );
}
