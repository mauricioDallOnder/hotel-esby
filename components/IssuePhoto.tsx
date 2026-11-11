"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Button, Skeleton, Typography } from "@mui/material";
import { photoSource } from "@/lib/photos";

export function IssuePhoto({
  issueId,
  index,
  alt,
  width = "100%",
  lazy = true,
  collection = "issues",
}: {
  issueId: string;
  index: number;
  alt: string;
  width?: string;
  lazy?: boolean;
  collection?: "issues" | "roomInspections";
}) {
  const source = photoSource(issueId, index, collection);
  // A different attachment gets fresh loading/error state, including reused dialogs.
  return <PhotoFrame key={source} source={source} index={index} alt={alt} width={width} lazy={lazy} />;
}

function PhotoFrame({ source, index, alt, width, lazy }: { source: string; index: number; alt: string; width: string; lazy: boolean }) {
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
    <Box ref={host} sx={{ minWidth: 0, width, flexShrink: 0 }}>
      <Box aria-busy={visible && status === "loading"} sx={{ position: "relative", height: 220, borderRadius: 3, overflow: "hidden", bgcolor: "action.hover" }}>
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
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          sx={{ height: "100%", objectFit: "contain", opacity: status === "ready" ? 1 : 0, bgcolor: "transparent" }}
        />}
      </Box>
    </Box>
  );
}
