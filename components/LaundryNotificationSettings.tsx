"use client";

import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import { useLaundryNotifications } from "@/context/LaundryNotificationsContext";

export function LaundryNotificationSettings() {
  const notifications = useLaundryNotifications();
  const { ready, supported, homeScreenRequired, permission, enabled, subscribed, status, statusLoaded, busy, error, feedback } = notifications;
  const backgroundActive = enabled && subscribed && status?.backgroundConfigured && status.schedulerRecent;
  const needsSubscription = enabled && !!status?.publicKey && !subscribed;
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <NotificationsActiveOutlinedIcon color="primary" />
        <Typography variant="h6" component="h2">Les rappels de la lingerie</Typography>
        {ready && <Chip size="small" color={backgroundActive ? "success" : "default"}
          label={backgroundActive ? "Activés sur cet appareil" : enabled ? "Avec l’application ouverte" : "À activer sur cet appareil"} />}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Un rappel 10 minutes avant la fin, puis quand le linge est prêt. Le numéro de la machine et la chambre apparaissent dans l’alerte.
      </Typography>
      {ready && homeScreenRequired && <Alert severity="info">
        Sur iPhone ou iPad (iOS 16.4 ou plus récent), ouvrez ce site dans Safari, puis <strong>Partager → Sur l’écran d’accueil</strong>.
        Ouvrez ensuite l’application depuis son icône pour activer les notifications.
      </Alert>}
      {ready && !supported && !homeScreenRequired && <Alert severity="info">
        Ce navigateur ne permet pas les notifications sur cet appareil. Les rappels restent visibles dans l’application ouverte.
      </Alert>}
      {ready && permission === "denied" && <Alert severity="warning">
        Notifications bloquées : ouvrez les réglages de ce site dans votre navigateur et autorisez les notifications.
      </Alert>}
      {statusLoaded && !status?.backgroundConfigured && <Typography variant="body2" color="text.secondary">
        {status ? "Les rappels lorsque l’application est fermée doivent encore être activés par la direction." : "Le service de rappels lorsque l’application est fermée est momentanément indisponible."}
        {" "}En attendant, gardez l’application ouverte et l’appareil éveillé pour recevoir les rappels.
      </Typography>}
      {status?.backgroundConfigured && !status.schedulerRecent && <Alert severity="warning">
        Les rappels automatiques n’ont pas encore confirmé leur fonctionnement. Gardez l’application ouverte en attendant.
      </Alert>}
      {backgroundActive && <Typography variant="body2" color="text.secondary">
        Les rappels peuvent arriver même après avoir fermé l’application. Une connexion Internet et l’autorisation de votre appareil sont nécessaires ; l’envoi peut prendre environ une minute.
      </Typography>}
      {error && <Alert severity="error">{error}</Alert>}
      {feedback && <Alert severity="info">{feedback}</Alert>}
      {ready && supported && !homeScreenRequired && <Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {(!enabled || needsSubscription) && <Button variant="contained" startIcon={<NotificationsActiveOutlinedIcon />} disabled={busy || !statusLoaded}
            onClick={() => void notifications.enable()}>{needsSubscription ? "Activer les rappels même après fermeture" : "Activer sur cet appareil"}</Button>}
          {enabled && <>
            <Button variant="outlined" disabled={busy} onClick={() => void notifications.test()}>Envoyer un test</Button>
            <Button disabled={busy} onClick={() => void notifications.disable()}>Désactiver sur cet appareil</Button>
          </>}
        </Stack>
      </Box>}
    </Stack>
  </Paper>;
}
