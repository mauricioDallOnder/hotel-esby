"use client";

import { useState } from "react";
import { Box, Button, Typography } from "@mui/material";

export function IssuePhoto({
  issueId,
  index,
  alt,
  width = "100%",
  lazy = true,
}: {
  issueId: string;
  index: number;
  alt: string;
  width?: string;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <Box sx={{ minWidth: 0, width, flexShrink: 0 }}>
      {failed ? (
        <Box sx={{ height: 220, display: "grid", alignContent: "center", textAlign: "center", bgcolor: "action.hover", borderRadius: 3 }}>
          <Typography variant="body2">Photo {index + 1} indisponible.</Typography>
          <Button onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>
            Réessayer la photo {index + 1}
          </Button>
        </Box>
      ) : (
        <Box
          key={attempt}
          component="img"
          className="photo-preview"
          src={`/api/photos/${issueId}?index=${index}${attempt ? `&retry=${attempt}` : ""}`}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </Box>
  );
}
