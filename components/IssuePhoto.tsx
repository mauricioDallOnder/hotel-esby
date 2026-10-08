"use client";

import { useState, useEffect } from "react";
import { Box, Button, Typography } from "@mui/material";

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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // NOVIDADE: Auto-retry inteligente para conexões 4G instáveis
  useEffect(() => {
    if (failed && attempt < 2) {
      const timer = setTimeout(() => {
        setAttempt((value) => value + 1);
        setFailed(false);
      }, 1500 * (attempt + 1)); // Espera 1.5s na primeira falha, e 3s na segunda
      return () => clearTimeout(timer);
    }
  }, [failed, attempt]);

  return (
    <Box sx={{ minWidth: 0, width, flexShrink: 0 }}>
      {failed && attempt >= 2 ? (
        <Box sx={{ height: 220, display: "grid", alignContent: "center", textAlign: "center", bgcolor: "action.hover", borderRadius: 3 }}>
          <Typography variant="body2">Photo {index + 1} indisponible.</Typography>
          <Button onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>
            Réessayer
          </Button>
        </Box>
      ) : (
        <Box
          key={attempt}
          component="img"
          className="photo-preview"
          src={`/api/photos/${issueId}?index=${index}&collection=${collection}${attempt ? `&retry=${attempt}` : ""}`}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </Box>
  );
}