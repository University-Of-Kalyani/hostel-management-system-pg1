"use server"

import { cached, cacheKeys } from "@/lib/cache"
import { formatIST } from "@/lib/date"
import { BillEntryType } from "@/lib/generated/prisma"
import prisma from "@/lib/prisma"
import { requireUser } from "@/lib/require-user"

/**
 * One finalized month as the boarders see it. Plain strings and numbers only:
 * it round-trips through Redis as JSON, where a Date would come back a string.
 */
export type BillNotice = {
  id: string
  month: string
  shortMonth: string
  publishedOn: string
  publishedBy: string | null
  rice: number
  vegetables: number
  fish: number
  grocery: number
  daily: number
  other: number
  adjustment: number
  total: number
  boarders: number
  perHead: number
}

// Finalizing clears the key, so this only bounds how long a stale entry can
// live - one written from the dev database, say, since the cache is shared.
const BILL_NOTICES_TTL = 10 * 60

async function fetchBillNotices(): Promise<BillNotice[]> {
  const audits = await prisma.audit.findMany({
    where: { approvedAt: { not: null } },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      approvedAt: true,
      approver: { select: { name: true } },
      riceExpenses: true,
      vegetableExpenses: true,
      fishExpenses: true,
      groceryExpenses: true,
      dailyExpenses: true,
      otherExpenses: true,
      adjustment: true,
      grandTotalExpenses: true,
      totalBoarders: true,
      mealCharge: true,
    },
  })

  return audits.map((a) => ({
    id: a.id,
    month: formatIST(a.date, "MMMM yyyy"),
    shortMonth: formatIST(a.date, "MMM yy"),
    publishedOn: a.approvedAt ? formatIST(a.approvedAt, "d MMM yyyy") : "",
    publishedBy: a.approver?.name ?? null,
    rice: a.riceExpenses,
    vegetables: a.vegetableExpenses,
    fish: a.fishExpenses,
    grocery: a.groceryExpenses,
    daily: a.dailyExpenses,
    other: a.otherExpenses,
    adjustment: a.adjustment,
    total: a.grandTotalExpenses,
    boarders: a.totalBoarders,
    perHead: a.mealCharge,
  }))
}

/**
 * Every published monthly bill, newest first, plus what each one charged the
 * viewer. The bills are the same for everyone and cached; the viewer's share
 * is theirs alone, so it's read fresh - one small query on their own rows.
 */
export async function getExpenseBoard() {
  const session = await requireUser()
  const userId = session.user.id

  const [notices, myCharges] = await Promise.all([
    cached(cacheKeys.billNotices(), BILL_NOTICES_TTL, fetchBillNotices),
    prisma.userBill.findMany({
      where: {
        userId,
        type: BillEntryType.MEAL_CHARGE,
        auditId: { not: null },
      },
      select: { auditId: true, amount: true },
    }),
  ])

  // A month with no row here is one the viewer wasn't billed for - excluded,
  // away, or not a boarder yet.
  const myShare: Record<string, number> = {}
  for (const c of myCharges) {
    if (c.auditId) myShare[c.auditId] = c.amount
  }

  return { notices, myShare }
}
