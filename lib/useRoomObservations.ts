"use client";
import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { today } from "./domain";
import { roomObservations } from "./roomObservations";
import type { RoomInspection } from "./rooms";

const emptyInspections: RoomInspection[] = [];

export function useRoomObservations() {
  const { roomInspections = emptyInspections } = useAppContext();
  const { pending } = useEntries();
  const [day, setDay] = useState(today);
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return useMemo(() => ({ ...roomObservations(roomInspections, pending, day), day }), [roomInspections, pending, day]);
}
