import { latestRoomRecords, roomTemperatureSchema, type RoomEntry, type RoomInspection } from "./rooms";

const temperatureFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 });

export function parseRoomTemperatureInput(value: string): number | undefined {
  const input = value.trim();
  if (!input) return undefined;
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(input)) return NaN;
  const temperature = Number(input.replace(",", "."));
  return Number.isFinite(temperature) ? temperature : NaN;
}

export function formatRoomTemperature(value?: number): string {
  const parsed = roomTemperatureSchema.safeParse(value);
  return parsed.success ? temperatureFormat.format(parsed.data) + " °C" : "Non renseignée";
}

/** A visit without a measurement does not replace the last known temperature. */
export function latestRoomTemperatures(history: (RoomEntry | RoomInspection)[], day: string) {
  return latestRoomRecords(history.filter(record => record.date <= day && roomTemperatureSchema.safeParse(record.temperatureC).success));
}
