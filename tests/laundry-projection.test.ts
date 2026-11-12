import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { laundryMachineStates, laundryStatesAt, nextLaundryPhaseAt, projectLaundry } from "../lib/laundry";
import { laundryNotices, laundryNoticesForCycles, nextLaundryNoticeAt } from "../lib/laundryNotifications";
import type { WorkEntry } from "../lib/rooms";

const startAt = Date.parse("2026-11-10T09:00:00.000Z"), endAt = startAt + 44 * 60_000;
const start = (): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0, expectedPreviousEventId: null,
  room: "101", date: "2026-11-10", actor: "Test", notes: "", occurredAt: new Date(startAt).toISOString(),
  laundryCycleId: createId(), laundryStatus: "en_cours", laundryStartedAt: new Date(startAt).toISOString(), laundryEndsAt: new Date(endAt).toISOString(),
  laundryCollectedAt: null, laundryCollectedBy: "",
});

test("a stable laundry projection preserves machine state, cycle history and the predecessor of a freed machine", () => {
  const first = start(), ended: WorkEntry = { ...first, id: createId(), expectedRevision: 1, expectedPreviousEventId: first.id, laundryStatus: "recupere", occurredAt: new Date(endAt).toISOString(), laundryCollectedAt: new Date(endAt).toISOString(), laundryCollectedBy: "Test" };
  const snapshot = projectLaundry([ended, first]);
  assert.equal(snapshot.machines.length, 6);
  assert.equal(snapshot.cycles.length, 1);
  assert.equal(snapshot.machines[0].cycle, undefined);
  assert.equal(snapshot.machines[0].revision, 2);
  assert.equal(snapshot.machines[0].lastEventId, ended.id);
  assert.deepEqual(laundryStatesAt(snapshot.machines, endAt), laundryMachineStates([ended, first], endAt));
  assert.equal(nextLaundryPhaseAt(snapshot.machines, endAt), null);
  assert.equal(nextLaundryNoticeAt(snapshot.cycles, endAt), null);
});

test("clock-only updates reuse the projected cycle and wake history only at a phase boundary", () => {
  const first = start(), snapshot = projectLaundry([first]), saved = structuredClone(snapshot);
  const before = laundryStatesAt(snapshot.machines, startAt), after = laundryStatesAt(snapshot.machines, endAt);
  assert.equal(before[0].cycle, after[0].cycle);
  assert.equal(before[0].phase, "running");
  assert.equal(after[0].phase, "ready");
  assert.equal(nextLaundryPhaseAt(snapshot.machines, startAt), endAt - 10 * 60_000);
  assert.equal(nextLaundryPhaseAt(snapshot.machines, endAt - 10 * 60_000), endAt);
  assert.equal(nextLaundryPhaseAt(snapshot.machines, endAt), null);
  assert.deepEqual(snapshot, saved);
});

test("notification scheduling retains both stages, push fallback deadlines and expiry without idle polling", () => {
  const first = start(), snapshot = projectLaundry([first]);
  const active = snapshot.machines.flatMap(machine => machine.cycle ? [machine.cycle] : []);
  const soon = endAt - 10 * 60_000;
  const boundaries = [soon, soon + 90_000, endAt, endAt + 90_000, endAt + 15 * 60_000];
  assert.equal(nextLaundryNoticeAt(active, startAt), boundaries[0]);
  boundaries.forEach((at, i) => {
    assert.equal(nextLaundryNoticeAt(active, at), boundaries[i + 1] ?? null);
    assert.deepEqual(laundryNoticesForCycles(active, at), laundryNotices([first], at));
  });
  assert.equal(nextLaundryNoticeAt([], startAt), null);
});
