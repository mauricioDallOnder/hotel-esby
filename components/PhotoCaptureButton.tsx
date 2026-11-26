"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

const maxEdge = 1280;
const cameraUnavailable = "La caméra est indisponible. Vous pouvez choisir une photo dans la galerie.";

function stopCamera(video: HTMLVideoElement) {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}

type CameraProps = {
  onClose: () => void;
  onCapture: (file: File) => void;
  onGallery: () => void;
};

function CameraPreview({ onClose, onCapture, onGallery }: CameraProps) {
  const preview = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = preview.current!;
    let active = true;
    function close() {
      active = false;
      stopCamera(video);
      onClose();
    }
    function onVisibilityChange() {
      if (document.hidden) close();
    }
    function onCameraEnded() {
      if (active) {
        stopCamera(video);
        setError(cameraUnavailable);
      }
    }
    async function startCamera() {
      if (!active) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: maxEdge, max: maxEdge },
            height: { ideal: 720, max: maxEdge },
          },
        });
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        video.srcObject = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener("ended", onCameraEnded, { once: true }));
        await video.play();
      } catch (reason) {
        if (!active) return;
        stopCamera(video);
        setError(reason instanceof Error && reason.name === "NotAllowedError"
          ? "Accès à la caméra refusé. Autorisez la caméra dans les paramètres du site ou choisissez une photo dans la galerie."
          : cameraUnavailable);
      }
    }
    // A dialog can close (or remount in development) before permission is granted.
    queueMicrotask(startCamera);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", close);
    return () => {
      active = false;
      stopCamera(video);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", close);
    };
  }, [onClose]);

  async function takePhoto() {
    const video = preview.current;
    const stream = video?.srcObject;
    if (!video || !stream || !ready || capturing) return;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    try {
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (video.srcObject !== stream) return;
      if (!blob?.size) throw new Error();
      stopCamera(video);
      onClose();
      onCapture(new File([blob], "photo.jpg", { type: blob.type }));
    } catch {
      if (video.srcObject !== stream) return;
      stopCamera(video);
      setError("Impossible de prendre la photo. Vous pouvez choisir une image dans la galerie.");
    } finally {
      canvas.width = canvas.height = 1;
    }
  }

  return <>
    <DialogContent>
      {error && <Alert severity="warning">{error}</Alert>}
      {!error && !ready && <Typography role="status">Ouverture de la caméra…</Typography>}
      <video ref={preview} muted playsInline aria-label="Aperçu de la caméra"
        onPlaying={() => setReady(true)}
        style={{ display: error ? "none" : "block", width: "100%", maxHeight: "60vh", objectFit: "contain" }} />
    </DialogContent>
    <DialogActions sx={{ flexWrap: "wrap" }}>
      <Button onClick={onClose}>Annuler</Button>
      {error ? <Button onClick={onGallery}>Choisir dans la galerie</Button>
        : <Button variant="contained" disabled={!ready || capturing} onClick={takePhoto}>Photographier</Button>}
    </DialogActions>
  </>;
}

export function PhotoCaptureButton({ disabled, onCapture, startIcon }: {
  disabled: boolean;
  onCapture: (file: File) => void;
  startIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

  function pickPhoto(gallery: boolean) {
    const picker = input.current;
    if (!picker) return;
    if (gallery) picker.removeAttribute("capture");
    else picker.setAttribute("capture", "environment");
    picker.click();
  }

  return <>
    <Button variant="outlined" startIcon={startIcon} disabled={disabled} onClick={() => {
      if (/Android/i.test(navigator.userAgent)) setOpen(true);
      else pickPhoto(false);
    }}>Prendre une photo</Button>
    <input ref={input} hidden type="file" accept="image/*" capture="environment" disabled={disabled}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) onCapture(file);
      }} />
    {open && <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>Appareil photo</DialogTitle>
      <CameraPreview onClose={close} onCapture={onCapture} onGallery={() => {
        close();
        pickPhoto(true);
      }} />
    </Dialog>}
  </>;
}
