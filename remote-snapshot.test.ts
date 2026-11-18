import assert from "node:assert/strict";
import test from "node:test";
import { ephemeralSnapshotStore, RemoteSnapshot, type SnapshotStore } from "./remote-snapshot";

interface Snapshot { readonly fetchedAt: number; readonly ids: string[] }

function store(initial?: unknown): SnapshotStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>(initial === undefined ? [] : [["key", initial]]);
  return { values, get: <T>(key: string) => values.get(key) as T | undefined, update: async (key, value) => { values.set(key, value); } };
}

function snapshotOf(options: { store: SnapshotStore; fetch: typeof fetch; now?: () => number }): RemoteSnapshot<Snapshot> {
  return new RemoteSnapshot<Snapshot>({
    cacheKey: "key",
    store: options.store,
    fetch: options.fetch,
    now: options.now,
    normalize: (payload, fetchedAt) => {
      const ids = (payload as { ids?: unknown }).ids;
      if (!Array.isArray(ids) || !ids.length) throw new Error("empty");
      return { fetchedAt, ids: ids as string[] };
    },
    parseCached: (value) => {
      const raw = value as Snapshot | undefined;
      return raw && typeof raw.fetchedAt === "number" && Array.isArray(raw.ids) ? raw : undefined;
    },
    empty: () => ({ fetchedAt: 0, ids: [] }),
  });
}

test("fetches once, persists, and shares an in-flight refresh", async () => {
  let calls = 0;
  const memory = store();
  const remote = snapshotOf({ store: memory, now: () => 1000, fetch: async () => { calls += 1; return Response.json({ ids: ["a"] }); } });
  const [first, second] = await Promise.all([remote.getOrRefresh(), remote.getOrRefresh()]);
  assert.deepEqual(first, { fetchedAt: 1000, ids: ["a"] });
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.deepEqual(memory.values.get("key"), first);
});

test("serves a fresh persisted snapshot and refreshes a stale one in the background", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => { calls += 1; return Response.json({ ids: ["new"] }); };
  const fresh = snapshotOf({ store: store({ fetchedAt: 1000, ids: ["cached"] }), now: () => 2000, fetch });
  assert.deepEqual((await fresh.getOrRefresh()).ids, ["cached"]);
  assert.equal(calls, 0);
  const stale = snapshotOf({ store: store({ fetchedAt: 0, ids: ["cached"] }), now: () => 7 * 60 * 60 * 1000, fetch });
  assert.deepEqual((await stale.getOrRefresh()).ids, ["cached"]);
  await stale.refresh();
  assert.deepEqual(stale.current?.ids, ["new"]);
});

test("keeps the last good snapshot when a refresh fails or returns unusable data", async () => {
  const cached = { fetchedAt: 5, ids: ["cached"] };
  const failing = snapshotOf({ store: store(cached), fetch: async () => new Response("", { status: 500 }) });
  assert.deepEqual(await failing.refresh(), cached);
  const unusable = snapshotOf({ store: store(cached), fetch: async () => Response.json({ ids: [] }) });
  assert.deepEqual(await unusable.refresh(), cached);
  const empty = snapshotOf({ store: store("malformed"), fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual(await empty.getOrRefresh(), { fetchedAt: 0, ids: [] });
  assert.equal(empty.current, undefined);
});

test("an ephemeral store persists nothing", async () => {
  const memory = ephemeralSnapshotStore();
  await memory.update("key", { fetchedAt: 1 });
  assert.equal(memory.get("key"), undefined);
});
