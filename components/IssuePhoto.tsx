"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, Typography } from "@mui/material";
import { photoSource } from "@/lib/photos";

export function IssuePhoto({
  issueId,
  index,
  alt,
  width = "100%",
  lazy = true,
  collection = "issues",
  photoCount = 1,
}: {
  issueId: string;
  index: number;
  alt: string;
  width?: string;
  lazy?: boolean;
  collection?: "issues" | "roomInspections";
  photoCount?: number;
}) {
  const source = photoSource(issueId, index, collection);
  // A different attachment gets fresh loading/error state, including reused dialogs.
  return <PhotoFrame key={source} issueId={issueId} collection={collection} source={source} index={index} alt={alt} width={width} lazy={lazy} photoCount={photoCount} />;
}

function PhotoFrame({ issueId, collection, source, index, alt, width, lazy, photoCount }: {
  issueId: string; collection: "issues" | "roomInspections"; source: string; index: number; alt: string; width: string; lazy: boolean; photoCount: number;
}) {
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(index);
  const titleId = useId();
  const count = Math.max(index + 1, photoCount), gallery = photoCount > 1;
  const expandedSource = photoSource(issueId, selected, collection);
  const expandedAlt = selected === index ? alt : /\bphoto\s+\d+/i.test(alt)
    ? alt.replace(/(\bphoto\s+)\d+/i, (_, prefix: string) => `${prefix}${selected + 1}`) : `${alt} · photo ${selected + 1}`;
  const move = (direction: number) => setSelected(current => Math.max(0, Math.min(count - 1, current + direction)));

  return <Box sx={{ minWidth: 0, width, flexShrink: 0 }}>
    <PhotoImage source={source} index={index} alt={alt} lazy={lazy} onReady={setReady} />
    <Button size="small" disabled={!ready} onClick={() => { setSelected(index); setExpanded(true); }} aria-label={`Agrandir : ${alt}`} sx={{ minHeight: 44 }}>Agrandir la photo {index + 1}</Button>
    <Dialog open={expanded} onClose={() => setExpanded(false)} fullWidth maxWidth="xl" aria-labelledby={titleId}
      onKeyDown={event => {
        if (!gallery || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }}>
      <DialogTitle id={titleId}>{expandedAlt}</DialogTitle>
      <DialogContent dividers sx={{ p: 1, textAlign: "center" }}>
        <PhotoImage key={expandedSource} source={expandedSource} index={selected} alt={expandedAlt} lazy={false} expanded />
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, p: 2 }}>
        {gallery && <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", gap: 1 }}>
          <Button onClick={() => move(-1)} disabled={selected === 0} aria-label="Photo précédente" sx={{ minHeight: 44 }}>Précédente</Button>
          <Typography variant="body2" role="status" aria-live="polite">Photo {selected + 1} sur {count}</Typography>
          <Button onClick={() => move(1)} disabled={selected === count - 1} aria-label="Photo suivante" sx={{ minHeight: 44 }}>Suivante</Button>
        </Stack>}
        <Button component="a" href={expandedSource} target="_blank" rel="noopener noreferrer" sx={{ minHeight: 44 }}>Ouvrir en taille originale</Button>
        <Button onClick={() => setExpanded(false)} sx={{ minHeight: 44 }}>Fermer</Button>
      </DialogActions>
    </Dialog>
  </Box>;
}

function PhotoImage({ source, index, alt, lazy, expanded = false, onReady }: {
  source: string; index: number; alt: string; lazy: boolean; expanded?: boolean; onReady?: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (visible || !host.current) return;
    if (!("IntersectionObserver" in window)) {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "250px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (status !== "error" || attempt >= 2 || !navigator.onLine) return;
    const timer = setTimeout(() => {
      setAttempt(value => value + 1);
      setStatus("loading");
    }, 1000 * (attempt + 1));
    return () => clearTimeout(timer);
  }, [status, attempt]);

  return (
      <Box ref={host} aria-busy={visible && status === "loading"} sx={{ position: "relative", height: expanded ? "70dvh" : 220, borderRadius: expanded ? 0 : 3, overflow: "hidden", bgcolor: "action.hover" }}>
        {status !== "ready" && <Box role={visible ? "status" : undefined} sx={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center", px: 2 }}>
          {status === "loading" ? <>
            {visible && <Skeleton aria-hidden variant="rectangular" sx={{ position: "absolute", inset: 0, height: "100%", transform: "none" }} />}
            <Typography variant="body2" color="text.secondary" sx={{ position: "relative" }}>{visible ? `Chargement de la photo ${index + 1}…` : `Photo ${index + 1}`}</Typography>
          </> : <>
            <Typography variant="body2">Photo {index + 1} indisponible.</Typography>
            <Button onClick={() => { setAttempt(value => value + 1); setStatus("loading"); }}>Réessayer la photo {index + 1}</Button>
          </>}
        </Box>}
        {visible && status !== "error" && <Box
          key={attempt}
          component="img"
          className="photo-preview"
          src={`${source}${attempt ? `&retry=${attempt}` : ""}`}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          onLoad={() => { setStatus("ready"); onReady?.(true); }}
          onError={() => { setStatus("error"); onReady?.(false); }}
          sx={{ width: "100%", height: "100%", objectFit: "contain", opacity: status === "ready" ? 1 : 0, bgcolor: "transparent" }}
        />}
      </Box>
  );
}
