"use server"

import { unstable_noStore as noStore, revalidatePath } from "next/cache"
import { after } from "next/server"
import requireManager from "@/data/manager/require-manager"
import { ApiResponse } from "@/types"
import z from "zod"

import { GetMealWithUser } from "@/types/prisma.type"
import { sendFineIssuedEmail, sendMealStatusEmail } from "@/lib/email"
import {
  BillEntryType,
  MealStatusType,
  NonVegType,
  NotificationType,
  Prisma,
  UserStatusType,
} from "@/lib/generated/prisma"
import { lockLedger } from "@/lib/ledger"
import prisma from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"
import { parseEnumList } from "@/lib/utils"
import { mealSchema } from "@/lib/validations"

import { CreateUserFineSchema, GetMealsSchema } from "./validations"

function revalidateMealSurfaces(userId?: string) {
  for (const base of ["/manager", "/mess-prefect"]) {
    revalidatePath(`${base}/users`)
    revalidatePath(`${base}/calander`)
    if (userId) revalidatePath(`${base}/users/${userId}`, "layout")
  }
}

interface MealsResponse {
  data: GetMealWithUser[]
  totalRows: number
  pageCount: number
}

export async function getMealsForManager(
  input: GetMealsSchema
): Promise<MealsResponse> {
  noStore()
  const {
    page,
    per_page,
    sort,
    status,
    nonVegType,
    user,
    operator = "and",
  } = input
  const offset = (page - 1) * per_page
  const [sortField, sortOrder] = (sort?.split(".") ?? [
    "updatedAt",
    "desc",
  ]) as [keyof Prisma.MealOrderByWithRelationInput, "asc" | "desc"]
  const statusList = parseEnumList(status, MealStatusType)
  const nonVegList = parseEnumList(nonVegType, NonVegType)

  const statusCondition =
    statusList.length > 0 ? { status: { in: statusList } } : undefined
  const nonVegCondition =
    nonVegList.length > 0 ? { nonVegType: { in: nonVegList } } : undefined

  const filters = [statusCondition, nonVegCondition].filter(
    Boolean
  ) as Prisma.MealWhereInput[]

  if (user) {
    filters.push({
      user: {
        OR: [
          { name: { contains: user, mode: "insensitive" } },
          { email: { contains: user, mode: "insensitive" } },
        ],
      },
    })
  }

  const userScope: Prisma.MealWhereInput = {
    user: {
      deletedAt: null,
      status: { notIn: [UserStatusType.INACTIVE, UserStatusType.FORMA] },
    },
  }

  const whereClause: Prisma.MealWhereInput =
    filters.length > 0
      ? operator === "or"
        ? { AND: [userScope, { OR: filters }] }
        : { AND: [userScope, ...filters] }
      : userScope

  try {
    const [data, totalRows] = await Promise.all([
      prisma.meal.findMany({
        where: whereClause,
        skip: offset,
        take: per_page,
        orderBy: {
          [sortField]: sortOrder,
        },
        include: {
          user: {
            select: {
              id: true,
              selfPhNo: true,
              image: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.meal.count({ where: whereClause }),
    ])

    return {
      data,
      totalRows,
      pageCount: Math.ceil(totalRows / per_page),
    }
  } catch {
    throw new Error("Failed to retrieve meal data.")
  }
}

type UpdateMealSchema = z.infer<typeof mealSchema>
export async function updateMeal(
  values: UpdateMealSchema & { id: string }
): Promise<ApiResponse> {
  noStore()
  const session = await requireManager()
  if (!session)
    return {
      status: "error",
      message: "Unauthorized",
    }
  const actorId = session.user.id
  if (!actorId) return { status: "error", message: "Unauthorized" }

  const parsed = mealSchema.safeParse(values)
  if (!parsed.success) {
    return {
      status: "error",
      message: `Invalid meal data - ${parsed.error.issues[0]?.message ?? "check the values"}`,
    }
  }

  try {
    // Captured before the write so the log shows what actually changed.
    const before = await prisma.meal.findUnique({
      where: { id: values.id },
      select: { type: true, nonVegType: true, dislikedNonVegTypes: true },
    })

    // Explicit fields: spreading `values` would also push `id` into the update
    // payload, and anything else a caller happened to include.
    const meal = await prisma.meal.update({
      where: { id: values.id },
      data: {
        type: parsed.data.type,
        nonVegType: parsed.data.nonVegType ?? NonVegType.NONE,
        dislikedNonVegTypes: parsed.data.dislikedNonVegTypes ?? [],
      },
      select: { userId: true },
    })

    revalidateMealSurfaces(meal.userId)

    prisma.activityLog
      .create({
        data: {
          userId: actorId,
          actionType: "MEAL_PREFERENCE_OVERRIDE",
          entityType: "MEAL",
          entityId: values.id,
          oldData: before ?? undefined,
          newData: {
            type: parsed.data.type,
            nonVegType: parsed.data.nonVegType ?? NonVegType.NONE,
            dislikedNonVegTypes: parsed.data.dislikedNonVegTypes ?? [],
          },
          details: `Meal preference updated by manager for user ${meal.userId}.`,
        },
      })
      .catch((err) => console.error("Activity log creation failed:", err))

    after(() =>
      sendPushToUser(meal.userId, {
        title: "Meal preference updated",
        body: "Your meal preference was updated by the manager. Check your profile if this wasn't expected.",
        icon: "/app-icon-192.png",
        url: "/dashboard",
        tag: `meal-preference-${values.id}`,
      }).catch((err) => console.error("Push notification failed:", err))
    )

    return {
      status: "success",
      message: "Meal preference updated successfully",
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again later.",
    }
  }
}

/**
 * Set a boarder's meal status. `guestMealSuspended` is written only when
 * given: suspending "regular + guest" passes true, lifting both passes false,
 * and anything else leaves guest booking as it was.
 */
export async function updateUserMealStatus(
  mealId: string,
  status: MealStatusType,
  { guestMealSuspended }: { guestMealSuspended?: boolean } = {}
): Promise<ApiResponse> {
  noStore()
  const session = await requireManager()
  if (!session)
    return {
      status: "error",
      message: "Unauthorized",
    }
  const actorId = session.user.id
  if (!actorId) return { status: "error", message: "Unauthorized" }

  try {
    const meal = await prisma.meal.update({
      where: {
        id: mealId,
      },
      data: {
        status,
        ...(guestMealSuspended !== undefined && { guestMealSuspended }),
      },
      include: {
        user: { select: { email: true, name: true } },
      },
    })
    revalidateMealSurfaces(meal.userId)

    // Distinct actionType from the boarder's own MEAL_STATUS_CHANGE: that one
    // is read by the "Meal On/Off Activity" log assuming actor === subject,
    // which isn't true here (the manager is the actor, the boarder is the
    // subject) — reusing it would misattribute the change in that view.
    prisma.activityLog
      .create({
        data: {
          userId: actorId,
          actionType: "MEAL_STATUS_OVERRIDE",
          entityType: "MEAL",
          entityId: mealId,
          newData: { status, guestMealSuspended, targetUserId: meal.userId },
          details: `Meal status set to ${status}${
            guestMealSuspended === true
              ? " (with guest meal)"
              : guestMealSuspended === false
                ? " (guest meal restored)"
                : ""
          } by manager for ${meal.user?.name ?? meal.userId}.`,
        },
      })
      .catch((err) => console.error("Activity log creation failed:", err))

    if (meal.user?.email) {
      await sendMealStatusEmail({
        to: meal.user.email,
        name: meal.user.name,
        status,
        guestMealSuspended:
          status === MealStatusType.SUSPENDED && meal.guestMealSuspended,
      })
    }

    return {
      status: "success",
      message: "Meal status updated successfully",
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again later.",
    }
  }
}
/**
 * Suspend or restore guest meal booking alone, leaving the regular meal as it
 * is. Idempotent: the update only matches a meal not already in that state,
 * so a double click or a second manager doing the same writes one log entry
 * and sends one notification.
 */
export async function updateGuestMealSuspension(
  mealId: string,
  suspended: boolean
): Promise<ApiResponse> {
  noStore()
  const session = await requireManager()
  const actorId = session?.user.id
  if (!actorId) return { status: "error", message: "Unauthorized" }

  try {
    const { count } = await prisma.meal.updateMany({
      where: { id: mealId, guestMealSuspended: !suspended },
      data: { guestMealSuspended: suspended },
    })
    const meal = await prisma.meal.findUnique({
      where: { id: mealId },
      select: { userId: true, user: { select: { name: true } } },
    })
    if (!meal) return { status: "error", message: "Meal not found" }

    const message = suspended
      ? "Guest meal suspended"
      : "Guest meal booking restored"
    if (count === 0) return { status: "success", message }

    revalidateMealSurfaces(meal.userId)

    prisma.activityLog
      .create({
        data: {
          userId: actorId,
          actionType: "MEAL_STATUS_OVERRIDE",
          entityType: "MEAL",
          entityId: mealId,
          newData: { guestMealSuspended: suspended, targetUserId: meal.userId },
          details: `Guest meal ${suspended ? "suspended" : "restored"} by manager for ${meal.user?.name ?? meal.userId}.`,
        },
      })
      .catch((err) => console.error("Activity log creation failed:", err))

    const body = suspended
      ? `${session.user.name} suspended your guest meal booking. Your regular meal is not affected.`
      : `${session.user.name} restored your guest meal booking.`

    prisma.notification
      .create({
        data: {
          title: suspended ? "Guest meal suspended" : "Guest meal restored",
          message: body,
          type: NotificationType.MEAL,
          user: { connect: { id: meal.userId } },
          issuer: { connect: { id: actorId } },
        },
      })
      .catch((err) => console.error("Notification creation failed:", err))

    after(() =>
      sendPushToUser(meal.userId, {
        title: suspended ? "Guest meal suspended" : "Guest meal restored",
        body,
        icon: "/app-icon-192.png",
        url: "/guest-meal",
        tag: `guest-meal-suspension-${mealId}`,
      }).catch((err) => console.error("Push notification failed:", err))
    )

    return { status: "success", message }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again later.",
    }
  }
}

export async function issueFineToUser({
  targetUserId,
  fineAmount,
  fineReason,
  fineDueDate,
}: CreateUserFineSchema): Promise<ApiResponse> {
  noStore()
  // console.log("[issueFineToUSerId] ", { targetUserId })

  const session = await requireManager()
  // console.log("[issueFineToUser] Session:", session)

  if (!session) {
    console.error("[issueFineToUser] Unauthorized")
    return { status: "error", message: "Unauthorized" }
  }
  const issuerUserId = session.user.id

  try {
    const fineAmountNumber = Number(fineAmount)
    // console.log("[issueFineToUser] Parsed fine amount:", fineAmountNumber)

    if (!Number.isFinite(fineAmountNumber) || fineAmountNumber <= 0) {
      console.error("[issueFineToUser] Invalid fine amount provided")
      return { status: "error", message: "Invalid fine amount provided" }
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true },
    })
    // console.log("[issueFineToUser] Target user:", targetUser)

    if (!targetUser) {
      console.error("[issueFineToUser] Target user not found in this hostel")
      return {
        status: "error",
        message: "Target user not found in this hostel",
      }
    }

    if (!issuerUserId) {
      throw new Error("Issuer is required to issue a fine")
    }

    const result = await prisma.$transaction(async (tx) => {
      // console.log("[issueFineToUser][TX] Starting transaction")
      const currentDue = await lockLedger(tx, targetUserId)

      const newFine = await tx.userFine.create({
        data: {
          userId: targetUserId,
          issuedBy: issuerUserId,
          amount: fineAmountNumber,
          reason: fineReason,
          dueDate: fineDueDate,
          status: "PENDING",
        },
      })
      // console.log("[issueFineToUser][TX] New fine created:", newFine)

      const newBalance = currentDue + fineAmountNumber

      const newBillEntry = await tx.userBill.create({
        data: {
          userId: targetUserId,
          fineId: newFine.id,
          type: BillEntryType.FINE_CHARGE,
          amount: newFine.amount,
          description: `Fine: ${newFine.reason}`,
          balanceRemaining: newBalance,
          isPaid: false,
          issueDate: new Date(),
          dueDate: newFine.dueDate,
        },
      })
      // console.log("[issueFineToUser][TX] New bill entry created:", newBillEntry)

      return { newFine, newBillEntry, newBalance, success: true as const }
    })
    // console.log("[issueFineToUser] Transaction result:", result)

    if (!result?.success) {
      throw new Error("Transaction completed but returned invalid result")
    }

    prisma.activityLog
      .create({
        data: {
          userId: issuerUserId,
          actionType: "FINE_ISSUED",
          entityType: "USER_FINE",
          entityId: result.newFine.id,
          newData: {
            targetUserId,
            amount: fineAmountNumber,
            reason: fineReason,
            dueDate: fineDueDate,
          },
          details: `Fine of ₹${fineAmountNumber} issued to ${targetUser.name ?? targetUserId}: ${fineReason}`,
        },
      })
      .catch((err) => console.error("Activity log creation failed:", err))

    await prisma.notification.create({
      data: {
        title: "New Fine Issued",
        message: `You have received a fine of ₹${fineAmountNumber} for: ${fineReason}.`,
        type: NotificationType.FINE,
        user: { connect: { id: targetUserId } },
        issuer: { connect: { id: issuerUserId } },
      },
    })
    // console.log("[issueFineToUser] Notification created successfully")

    if (targetUser.email) {
      await sendFineIssuedEmail({
        to: targetUser.email,
        name: targetUser.name,
        amount: fineAmountNumber,
        reason: fineReason,
        dueDate: fineDueDate,
        fineId: result.newFine.id,
      })
    }

    return { status: "success", message: "Fine issued successfully" }
  } catch (error) {
    console.error("[issueFineToUser] Error occurred:", error)
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again later.",
    }
  }
}
