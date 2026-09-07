"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { Command, State } from "@/lib/domain";

type Data = State & { mode: "local" | "sheets" };
type Context = Data & {
  hotelName: string;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  mutate: (command: Command) => Promise<Data>;
  logout: () => Promise<void>;
};
const AppContext = createContext<Context | null>(null);
export function useAppContext() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider manquant");
  return value;
}
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>({
    issues: [],
    inspections: [],
    mode: "local",
  });
  const [session, setSession] = useState<{
    authenticated: boolean;
    configured: boolean;
    hotelName: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const inFlight = useRef(false);
  const request = useCallback(async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { ...options, cache: "no-store" });
    const result = await response.json();
    if (response.status === 401)
      setSession((s) => (s ? { ...s, authenticated: false } : s));
    if (!response.ok) throw new Error(result.error || "Erreur de connexion.");
    return result;
  }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    try {
      setError("");
      setData(await request("/api/hotel"));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion impossible.");
    }
  }, [request]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Session inaccessible.");
        return response.json();
      })
      .then(async (result) => {
        if (cancelled) return;
        setSession(result);
        if (result.authenticated) await refresh();
      })
      .catch(() => {
        if (!cancelled) setError("Serveur inaccessible. Rechargez la page.");
      });
    return () => {
      cancelled = true;
    };
  }, [request, refresh]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setSession(await request("/api/session"));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(command: Command): Promise<Data> {
    if (inFlight.current)
      throw new Error("Un enregistrement est déjà en cours.");
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result: Data = await request("/api/hotel", {
        method: command.type === "updateIssue" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      setData(result);
      return result;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    await request("/api/session", { method: "DELETE" });
    setLoaded(false);
    setData({ issues: [], inspections: [], mode: "local" });
    setSession(await request("/api/session"));
  }
  if (!session || (session.authenticated && !loaded))
    return (
      <Box sx={{ p: 5, textAlign: "center" }}>
        {error ? (
          <Alert
            severity="error"
            action={
              <Button onClick={() => window.location.reload()}>
                Réessayer
              </Button>
            }
          >
            {error}
          </Alert>
        ) : (
          <>
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>Chargement de votre espace…</Typography>
          </>
        )}
      </Box>
    );
  if (!session.authenticated)
    return (
      <Box
        sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}
      >
        <Paper sx={{ p: 4, width: "100%", maxWidth: 420 }}>
          <Stack component="form" onSubmit={login} spacing={3}>
            <Typography variant="overline" color="primary">
              Hôtel Contrôle
            </Typography>
            <Typography variant="h4">Bienvenue</Typography>
            <Typography color="text.secondary">
              Connectez-vous pour accéder aux rondes et au suivi des
              interventions.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {!session.configured ? (
              <Alert severity="info">
                Définissez APP_PASSWORD dans la configuration du serveur pour
                activer l’accès.
              </Alert>
            ) : (
              <>
                <TextField
                  required
                  type="password"
                  label="Mot de passe de l’équipe"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button disabled={busy} type="submit" variant="contained">
                  Se connecter
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      </Box>
    );
  return (
    <AppContext.Provider
      value={{
        ...data,
        hotelName: session.hotelName,
        busy,
        error,
        refresh,
        mutate,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
