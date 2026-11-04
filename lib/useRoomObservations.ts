"use client";
import { useEffect, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { today } from "./domain";
import { roomObservations } from "./roomObservations";

export function useRoomObservations() {
  const { roomInspections = [] } = useAppContext();
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
  return { ...roomObservations(roomInspections, pending, day), day };
}
