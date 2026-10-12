import { describe, expect, it, vi } from "vitest"

import { Prisma } from "@/lib/generated/prisma"
import { lockLedger, lockLedgers } from "@/lib/ledger"

vi.mock("server-only", () => ({}))

type Bill = { userId: string; balanceRemaining: number }

/**
 * Records the order of the lock and the balance read. The real guarantee
 * (a second writer waits) is Postgres's; what can break here is the order.
 */
function fakeTx(bills: Bill[]) {
  const calls: string[] = []
  let lockedIds: unknown[] = []
  const tx = {
    $queryRaw: vi.fn(
      async (_strings: TemplateStringsArray, ids: Prisma.Sql) => {
        calls.push("lock")
        lockedIds = ids.values
        return []
      }
    ),
    userBill: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
        calls.push("read")
        return bills.find((b) => b.userId === where.userId) ?? null
      }),
      findMany: vi.fn(
        async ({ where }: { where: { userId: { in: string[] } } }) => {
          calls.push("read")
          return bills.filter((b) => where.userId.in.includes(b.userId))
        }
      ),
    },
  }
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    calls,
    lockedIds: () => lockedIds,
  }
}

describe("lockLedger", () => {
  // Two managers approved the same guest meal 0.4s apart: both read the
  // balance before either wrote, so the meal was charged twice. The lock has
  // to come first or the second writer reads a stale balance anyway.
  it("locks the user before reading the balance", async () => {
    const { tx, calls, lockedIds } = fakeTx([
      { userId: "u1", balanceRemaining: 2745 },
    ])
    expect(await lockLedger(tx, "u1")).toBe(2745)
    expect(calls).toEqual(["lock", "read"])
    expect(lockedIds()).toEqual(["u1"])
  })

  it("starts a user with no bills at zero", async () => {
    const { tx } = fakeTx([])
    expect(await lockLedger(tx, "u1")).toBe(0)
  })
})

describe("lockLedgers", () => {
  it("locks every user once, in id order, before reading", async () => {
    const { tx, calls, lockedIds } = fakeTx([
      { userId: "b", balanceRemaining: 50 },
      { userId: "a", balanceRemaining: -10 },
    ])
    const balances = await lockLedgers(tx, ["c", "a", "b", "a"])
    // Sorted, so two finalize-style writers can't lock in opposite orders
    // and deadlock each other.
    expect(lockedIds()).toEqual(["a", "b", "c"])
    expect(calls).toEqual(["lock", "read"])
    expect(Object.fromEntries(balances)).toEqual({ a: -10, b: 50, c: 0 })
  })

  it("touches nothing for an empty list", async () => {
    const { tx, calls } = fakeTx([])
    expect((await lockLedgers(tx, [])).size).toBe(0)
    expect(calls).toEqual([])
  })
})
