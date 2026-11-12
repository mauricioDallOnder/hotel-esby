import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type E2ELocalData = { directory: string; token: string };
export const e2eDataMarker = ".hotel-e2e-owner.json";
const purpose = "hotel-playwright-local-data";

function refuse(reason: string): never {
  throw new Error(`Refusing to reset E2E data: ${reason}`);
}

/** Only a marked directory created by this harness, directly below tmpdir. */
function assertOwned(data: E2ELocalData) {
  if (!path.isAbsolute(data.directory) || !/^hotel-e2e-[A-Za-z0-9_-]+$/.test(path.basename(data.directory)) ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.token))
    refuse("invalid temporary directory or ownership token.");
  const directory = realpathSync(data.directory);
  if (!lstatSync(data.directory).isDirectory() || directory !== path.resolve(data.directory) ||
    path.dirname(directory) !== realpathSync(tmpdir()))
    refuse("the directory must be a real hotel-e2e-* directory directly inside tmpdir.");
  const markerPath = path.join(directory, e2eDataMarker);
  if (!lstatSync(markerPath).isFile()) refuse("the ownership marker must be a regular file.");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker?.version !== 1 || marker.purpose !== purpose || marker.directory !== directory || marker.token !== data.token)
    refuse("the directory does not belong to this test run.");
}

/** Config is evaluated again in workers; inherit the same server directory. */
export function prepareE2ELocalData(environment: Record<string, string | undefined> = process.env): E2ELocalData {
  const directory = environment.HOTEL_E2E_DATA_DIR, token = environment.HOTEL_E2E_DATA_TOKEN;
  if (directory !== undefined || token !== undefined) {
    if (!directory || !token) refuse("both the directory and its token are required.");
    const data = { directory, token };
    assertOwned(data);
    return data;
  }
  // Never accept LOCAL_DATA_DIR from the caller: operational local data is outside this harness.
  const data = { directory: mkdtempSync(path.join(realpathSync(tmpdir()), "hotel-e2e-")), token: randomUUID() };
  writeFileSync(path.join(data.directory, e2eDataMarker), JSON.stringify({ version: 1, purpose, ...data }), { flag: "wx", mode: 0o600 });
  environment.HOTEL_E2E_DATA_DIR = data.directory;
  environment.HOTEL_E2E_DATA_TOKEN = data.token;
  return data;
}

export function resetE2ELocalData(data: E2ELocalData) {
  assertOwned(data);
  // Check every target before changing anything. Never follow a replacement symlink.
  for (const name of ["hotel.json", "laundry-notifications.json", "photos"]) {
    const target = path.join(data.directory, name);
    let stat;
    try { stat = lstatSync(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (name === "photos" ? !stat.isDirectory() : !stat.isFile()) ||
      path.dirname(realpathSync(target)) !== data.directory)
      refuse(`unexpected storage target: ${name}.`);
  }
  const temporary = path.join(data.directory, `hotel.e2e-reset-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ issues: [], inspections: [], roomInspections: [], workEvents: [], familyEvents: [], deletedFamilyEventIds: [] }), { flag: "wx", mode: 0o600 });
    renameSync(temporary, path.join(data.directory, "hotel.json"));
    rmSync(path.join(data.directory, "photos"), { recursive: true, force: true });
    rmSync(path.join(data.directory, "laundry-notifications.json"), { force: true });
  } finally {
    rmSync(temporary, { force: true });
  }
}
