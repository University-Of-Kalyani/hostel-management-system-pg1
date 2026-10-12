import "server-only"

import { Prisma } from "@/lib/generated/prisma"

/**
 * Every ledger row stores the running balance, worked out from the row before
 * it. Two writers that read that row at the same moment both build on it, so
 * one amount never reaches the balance - and a writer that first checks "is
 * this already billed?" finds nothing either, so it bills twice. That is how
 * two managers approving the same guest meal 0.4s apart charged it twice.
 *
 * Locking the user's row first makes the second writer wait until the first
 * commits; its reads then see what the first one wrote. So: call this first
 * thing in the transaction, before any read the write depends on.
 *
 * NO KEY UPDATE rather than UPDATE: it still serialises ledger writers, but
 * doesn't block inserts elsewhere that only reference the user (notifications,
 * activity logs).
 */
async function lockUsers(tx: Prisma.TransactionClient, userIds: string[]) {
  // Sorted, so two writers locking overlapping sets can't deadlock.
  await tx.$queryRaw`
    SELECT "id" FROM "users"
    WHERE "id" IN (${Prisma.join(userIds)})
    ORDER BY "id"
    FOR NO KEY UPDATE`
}

/** Lock one user's ledger for the transaction; returns their current balance. */
export async function lockLedger(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<number> {
  await lockUsers(tx, [userId])
  const lastBill = await tx.userBill.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { balanceRemaining: true },
  })
  return lastBill?.balanceRemaining ?? 0
}

/** Lock several users' ledgers at once; returns each one's current balance. */
export async function lockLedgers(
  tx: Prisma.TransactionClient,
  userIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)].sort()
  if (ids.length === 0) return new Map()

  await lockUsers(tx, ids)
  const latestBills = await tx.userBill.findMany({
    where: { userId: { in: ids } },
    orderBy: { createdAt: "desc" },
    distinct: ["userId"],
    select: { userId: true, balanceRemaining: true },
  })
  const balanceByUser = new Map(
    latestBills.map((b) => [b.userId, b.balanceRemaining])
  )
  return new Map(ids.map((id) => [id, balanceByUser.get(id) ?? 0]))
}
