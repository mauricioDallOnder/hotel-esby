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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { Command, State } from "@/lib/domain";
import { mergeHotel } from "@/lib/mergeHotel";
import { deviceStore } from "@/lib/deviceStore";
import { EntriesProvider } from "./EntriesContext";
import type { EntryChange } from "@/lib/rooms";
import { roles, type Role } from "@/lib/roles";

type Data = State & { mode: "local" | "sheets" };
type Context = Data & {
  hotelName: string;
  role: Role;
  busy: boolean;
  error: string;
  cachedAt: string;
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
    role: Role | null;
    availableRoles: Role[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cachedAt, setCachedAt] = useState("");
  const hasLoaded = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState<Role>("employe");
  const inFlight = useRef(false);
  const request = useCallback(async (url: string, options?: RequestInit) => {
    let response: Response;
    try {
      response = await fetch(url, { ...options, cache: "no-store" });
    } catch {
      throw new Error("Connexion interrompue. Vérifiez votre réseau puis réessayez.");
    }
    if (response.status === 401)
      setSession((s) => (s ? { ...s, authenticated: false } : s));
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Le serveur n’a pas pu répondre. Réessayez dans quelques instants.");
    }
    if (!response.ok) throw new Error(result.error || "Erreur de connexion.");
    return result;
  }, []);
  const refresh = useCallback(async (fresh = true) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setError("");
      // Restore only after /api/session has authenticated the current user.
      if (!hasLoaded.current) {
        try {
          const snapshot = await deviceStore<{ data: Data; at: string } | undefined>("get", "snapshot");
          if (snapshot?.data && Array.isArray(snapshot.data.issues) && Array.isArray(snapshot.data.inspections)) {
            setData(snapshot.data); setCachedAt(snapshot.at); setLoaded(true); hasLoaded.current = true;
          }
        } catch { /* A cache failure must not prevent a live read. */ }
      }
      const result: Data = await request(fresh ? "/api/hotel?fresh=1" : "/api/hotel");
      setData(current => mergeHotel(current, result));
      setLoaded(true);
      hasLoaded.current = true;
      setCachedAt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion impossible.");
    } finally {
      inFlight.current = false;
      setBusy(false);
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
        if (result.availableRoles?.length)
          setLoginRole(result.availableRoles.includes("employe") ? "employe" : result.availableRoles[0]);
        if (result.authenticated) await refresh(false);
      })
      .catch(() => {
        if (!cancelled) setError("Serveur inaccessible. Rechargez la page.");
      });
    return () => {
      cancelled = true;
    };
  }, [request, refresh]);
  useEffect(() => {
    if (!loaded || cachedAt || !session?.authenticated) return;
    // Records only; photo bytes are downloaded on demand and never included here.
    void deviceStore("put", "snapshot", { data, at: new Date().toISOString() }).catch(() => {});
  }, [data, loaded, cachedAt, session?.authenticated]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, role: loginRole }),
      });
      setPassword("");
      setSession(await request("/api/session"));
      await refresh(false);
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
      setData(current => mergeHotel(current, result));
      return result;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const mergeEntry = useCallback((change: EntryChange) => {
    setData(current => change.collection === "familyEvents"
      ? { ...current, familyEvents: [...(current.familyEvents || []).filter(r => r.id !== change.record.id), change.record] }
      : { ...current, roomInspections: [...(current.roomInspections || []).filter(r => r.id !== change.record.id), change.record] });
  }, []);
  async function logout() {
    await request("/api/session", { method: "DELETE" });
    setLoaded(false);
    hasLoaded.current = false;
    setCachedAt("");
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
              <Button disabled={busy} onClick={() => session?.authenticated ? void refresh() : window.location.reload()}>
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
                Les accès ne sont pas encore configurés. Contactez la direction.
              </Alert>
            ) : (
              <>
                <TextField
                  select
                  label="Profil"
                  value={loginRole}
                  disabled={busy}
                  onChange={(e) => {
                    setLoginRole(e.target.value as Role);
                    setPassword("");
                    setError("");
                  }}
                >
                  {Object.entries(roles).map(([value, label]) => (
                    <MenuItem key={value} value={value} disabled={!session.availableRoles.includes(value as Role)}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  required
                  type="password"
                  label={`Mot de passe · ${roles[loginRole]}`}
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
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
        role: session.role!,
        busy,
        error,
        cachedAt,
        refresh,
        mutate,
        logout,
      }}
    >
      <EntriesProvider onSaved={mergeEntry}>{children}</EntriesProvider>
    </AppContext.Provider>
  );
}
