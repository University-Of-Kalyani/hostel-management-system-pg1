"use server"

import { revalidatePath } from "next/cache"
import requireMessPrefect from "@/data/mess-prefect/require-mess-prefect"
import { ApiResponse } from "@/types"
import { z } from "zod"

import { NotificationType, UserStatusType } from "@/lib/generated/prisma"
import prisma from "@/lib/prisma"

const userIdSchema = z.object({ userId: z.string().min(1) })

const STATUS_CHANGED =
  "This user's status was changed just now. Reload the list and check it."

export async function approveUser(input: {
  userId: string
}): Promise<ApiResponse> {
  const session = await requireMessPrefect()
  const actorId = session?.user.id
  if (!actorId) return { status: "error", message: "Unauthorized" }

  const parsed = userIdSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: "Invalid input" }

  try {
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, name: true, status: true, joinDate: true },
    })
    if (!target) return { status: "error", message: "User not found" }
    if (target.status === UserStatusType.ACTIVE) {
      return { status: "success", message: "User is already active." }
    }

    await prisma.$transaction(async (tx) => {
      // Only from the status just read: a double click, or an approve racing
      // a reject, would otherwise both apply and both notify.
      const { count } = await tx.user.updateMany({
        where: { id: target.id, status: target.status },
        data: {
          status: UserStatusType.ACTIVE,
          joinDate: target.joinDate ?? new Date(),
        },
      })
      if (count === 0) throw new Error(STATUS_CHANGED)

      await tx.activityLog.create({
        data: {
          userId: actorId,
          actionType: "USER_APPROVAL",
          entityType: "USER",
          entityId: target.id,
          oldData: { status: target.status },
          newData: { status: UserStatusType.ACTIVE },
          details: `Approved ${target.name ?? target.id} as an active boarder.`,
        },
      })

      await tx.notification.create({
        data: {
          title: "Account Approved 🎉",
          message:
            "Your account has been approved. You are now an active boarder and can use the mess services.",
          type: NotificationType.SYSTEM,
          user: { connect: { id: target.id } },
          issuer: { connect: { id: actorId } },
        },
      })
    })

    revalidatePath("/mess-prefect/approvals")
    return {
      status: "success",
      message: `${target.name ?? "User"} approved and activated.`,
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

export async function rejectUser(input: {
  userId: string
}): Promise<ApiResponse> {
  const session = await requireMessPrefect()
  const actorId = session?.user.id
  if (!actorId) return { status: "error", message: "Unauthorized" }

  const parsed = userIdSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: "Invalid input" }

  try {
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, name: true, status: true },
    })
    if (!target) return { status: "error", message: "User not found" }

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: target.id, status: target.status },
        data: { status: UserStatusType.SUSPENDED },
      })
      if (count === 0) throw new Error(STATUS_CHANGED)

      await tx.activityLog.create({
        data: {
          userId: actorId,
          actionType: "USER_REJECTION",
          entityType: "USER",
          entityId: target.id,
          oldData: { status: target.status },
          newData: { status: UserStatusType.SUSPENDED },
          details: `Rejected/suspended ${target.name ?? target.id}.`,
        },
      })
    })

    revalidatePath("/mess-prefect/approvals")
    return {
      status: "success",
      message: `${target.name ?? "User"} was rejected.`,
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
