import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { workEntrySchema, type WorkEntry } from "../lib/rooms";
import { activeLaundryCycle, getLaundryMachine, laundryCycles, laundryMachines, laundryMachineStates, laundryPhase, laundryTiming } from "../lib/laundry";
import { validateWorkEntry } from "../lib/work";

const startedAt = "2026-11-10T09:00:00.000Z";
const start = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0,
  room: "101", date: "2026-11-10", actor: "Agent exemple", notes: "Sac bleu de démonstration.", occurredAt: startedAt,
  laundryCycleId: createId(), laundryStatus: "en_cours", laundryStartedAt: startedAt,
  laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "Résident exemple", ...patch,
});
const collected = (input: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => ({
  ...input, id: createId(), expectedRevision: input.expectedRevision + 1,
  actor: "Autre agent", occurredAt: "2026-11-10T09:45:00.000Z", laundryStatus: "recupere",
  laundryCollectedAt: "2026-11-10T09:45:00.000Z", laundryCollectedBy: "Autre agent", ...patch,
});

test("six distinct machine IDs retain the requested labels, capacities and fixed programmes", () => {
  assert.deepEqual(laundryMachines.map(machine => [machine.id, machine.durationMinutes]), [
    ["washer-1", 40], ["washer-2", 30], ["washer-3", 30], ["dryer-1", 80], ["dryer-2", 80], ["dryer-3", 80],
  ]);
  assert.deepEqual(laundryMachines.filter(machine => machine.kind === "washer").map(machine => machine.capacityKg), [18, 8, 8]);
  assert.equal(getLaundryMachine("washer-3")?.label, "Machine à laver 3");
  assert.equal(getLaundryMachine("dryer-3")?.label, "Machine à sécher 3");
  assert.equal(getLaundryMachine("3"), undefined);
  for (const machine of laundryMachines) assert.equal(workEntrySchema.safeParse(start({ targetId: machine.id })).success, true);
});

test("laundry requires room, action timestamps and explicit custody fields, without leaking to other work kinds", () => {
  const input = start();
  assert.equal(workEntrySchema.safeParse(input).success, true);
  assert.equal(workEntrySchema.safeParse(collected(input)).success, true);
  assert.equal(workEntrySchema.safeParse({ ...input, laundryStatus: "annule", occurredAt: "2026-11-10T09:05:00.000Z" }).success, true);
  const invalid = [
    start({ targetId: "washer-4" }), start({ room: "" }), start({ room: "999" }),
    start({ laundryCycleId: undefined }), start({ laundryStatus: undefined }), start({ laundryStartedAt: undefined }),
    start({ laundryCollectedAt: undefined }), start({ laundryCollectedBy: undefined }),
    start({ laundryStartedAt: "2026-11-10T10:00:00.000Z" }), start({ occurredAt: "2026-11-10T09:05:00.000Z" }),
    start({ laundryCollectedAt: startedAt }), start({ laundryCollectedBy: "Agent exemple" }),
    start({ free: true }), start({ done: false }), start({ roomUnidentified: true }),
    collected(input, { laundryCollectedAt: null }), collected(input, { laundryCollectedBy: "" }),
    collected(input, { laundryCollectedBy: "Un autre nom" }), collected(input, { laundryCollectedAt: startedAt }),
    collected(input, { occurredAt: "2026-11-10T08:00:00.000Z", laundryCollectedAt: "2026-11-10T08:00:00.000Z" }),
    { ...input, kind: "roomAvailability", targetId: "101", free: true },
  ];
  for (const entry of invalid) assert.equal(workEntrySchema.safeParse(entry).success, false, JSON.stringify(entry));
});

test("laundry additions preserve the exact parsed fields and hash of existing occupancy entries", () => {
  const old = { type: "createWorkEvent", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "roomAvailability", targetId: "101", expectedRevision: 0,
    room: "101", date: "2026-10-17", actor: "Employé", notes: "", occurredAt: "2026-10-17T10:00:00.000Z", free: true };
  const parsed = workEntrySchema.parse(old);
  assert.deepEqual(parsed, old);
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(parsed), hash(old));
  assert.equal(Object.keys(parsed).some(key => key.startsWith("laundry")), false);
});

test("one active cycle reserves a machine until explicit removal, even after its timer expires", () => {
  const first = start();
  assert.equal(validateWorkEntry(first, [], []), undefined);
  assert.match(validateWorkEntry(start(), [first], [])!, /modifié ailleurs/);
  const another = start({ expectedRevision: 1, laundryStartedAt: "2026-11-10T12:00:00.000Z", occurredAt: "2026-11-10T12:00:00.000Z" });
  assert.match(validateWorkEntry(another, [first], [])!, /contient déjà du linge/);
  assert.equal(validateWorkEntry(start({ targetId: "dryer-3" }), [first], []), undefined);
  assert.equal(validateWorkEntry(start({ targetId: "washer-3" }), [first], []), undefined);
  const removed = collected(first);
  assert.equal(validateWorkEntry(removed, [first], []), undefined);
  assert.equal(validateWorkEntry({ ...another, expectedRevision: 2 }, [first, removed], []), undefined);
  assert.match(validateWorkEntry(collected(first, { expectedRevision: 2 }), [first, removed], [])!, /n’est plus en cours/);
});

test("cycle transitions preserve ownership, reject cross-machine collection and cannot reopen or reuse cycle IDs", () => {
  const first = start(), removed = collected(first);
  for (const patch of [{ room: "102" }, { laundryStartedAt: "2026-11-10T08:30:00.000Z" }, { laundryOwner: "Autre résident" }])
    assert.match(validateWorkEntry(collected(first, patch), [first], [])!, /conserver/);
  assert.match(validateWorkEntry(collected(first, { targetId: "dryer-3", expectedRevision: 0 }), [first], [])!, /n’est plus en cours/);
  assert.match(validateWorkEntry(collected(first, { laundryCycleId: createId() }), [first], [])!, /n’est plus en cours/);
  assert.match(validateWorkEntry({ ...first, id: createId(), expectedRevision: 2 }, [first, removed], [])!, /existe déjà/);
  assert.match(validateWorkEntry(start({ targetId: "dryer-3", laundryCycleId: first.laundryCycleId }), [first, removed], [])!, /existe déjà/);
  assert.match(validateWorkEntry(start({ expectedRevision: 2 }), [first, removed], [])!, /avant la libération/);
  const cancelled = { ...first, id: createId(), expectedRevision: 1, laundryStatus: "annule" as const, occurredAt: "2026-11-10T09:05:00.000Z" };
  assert.equal(validateWorkEntry(cancelled, [first], []), undefined);
  assert.equal(validateWorkEntry(start({ expectedRevision: 2, laundryStartedAt: "2026-11-10T09:06:00.000Z", occurredAt: "2026-11-10T09:06:00.000Z" }), [first, cancelled], []), undefined);
});

test("absolute start timestamps drive the ten-minute warning and ready state after reload or a suspended tab", () => {
  const input = start(), cycle = laundryCycles([input])[0];
  assert.equal(cycle.endsAt, "2026-11-10T09:40:00.000Z");
  assert.equal(laundryPhase(cycle, Date.parse("2026-11-10T09:29:59.999Z")), "running");
  assert.equal(laundryPhase(cycle, Date.parse("2026-11-10T09:30:00.000Z")), "soon");
  assert.equal(laundryPhase(cycle, Date.parse("2026-11-10T09:39:59.999Z")), "soon");
  assert.equal(laundryPhase(cycle, Date.parse("2026-11-10T09:40:00.000Z")), "ready");
  const resumed = laundryCycles(JSON.parse(JSON.stringify([input])))[0];
  assert.deepEqual(laundryTiming(resumed, Date.parse("2026-11-10T12:00:00.000Z")), { endsAt: cycle.endsAt, remainingMs: 0, totalMs: 2_400_000, progress: 100 });
  assert.equal(activeLaundryCycle("washer-1", [input])?.cycleId, input.laundryCycleId);
  assert.equal(laundryMachineStates([input], Date.parse("2026-11-10T12:00:00.000Z"))[0].phase, "ready");
  assert.equal(laundryPhase(laundryCycles([input, collected(input)])[0], Date.parse(startedAt)), "collected");
});

test("history preserves room and custody per cycle while each machine exposes only its latest reservation", () => {
  const first = start(), removed = collected(first);
  const second = start({ expectedRevision: 2, room: "102", actor: "Troisième agent", laundryStartedAt: "2026-11-10T10:00:00.000Z", occurredAt: "2026-11-10T10:00:00.000Z" });
  const dryer = start({ targetId: "dryer-3" });
  const events = [second, removed, dryer, first], before = structuredClone(events);
  const cycles = laundryCycles(events);
  assert.equal(cycles.length, 3);
  const original = cycles.find(cycle => cycle.cycleId === first.laundryCycleId)!;
  assert.equal(original.actor, "Agent exemple");
  assert.equal(original.collectedBy, "Autre agent");
  assert.equal(original.collectedAt, "2026-11-10T09:45:00.000Z");
  assert.equal(original.room, "101");
  assert.deepEqual(original.history.map(event => event.id), [removed.id, first.id]);
  assert.equal(cycles[0].cycleId, second.laundryCycleId);
  const machines = laundryMachineStates(events, Date.parse("2026-11-10T10:10:00.000Z"));
  assert.equal(machines.length, 6);
  assert.equal(machines[0].cycle?.room, "102");
  assert.equal(machines[0].revision, 3);
  assert.equal(machines[5].cycle?.cycleId, dryer.laundryCycleId);
  assert.equal(machines[1].phase, "available");
  assert.equal(machines[1].revision, 0);
  const freed = laundryMachineStates([first, removed]);
  assert.equal(freed[0].phase, "available");
  assert.equal(freed[0].revision, 2);
  assert.equal(freed[0].cycle, undefined);
  assert.equal(activeLaundryCycle("washer-1", [first, removed]), undefined);
  assert.deepEqual(events, before);
});
