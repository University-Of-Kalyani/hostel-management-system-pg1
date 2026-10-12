"use server"

import { after } from "next/server"
import requireManager from "@/data/manager/require-manager"
import { ApiResponse } from "@/types"

import { isManager } from "@/lib/authz"
import {
  BillEntryType,
  GuestMealStatusType,
  NotificationType,
} from "@/lib/generated/prisma"
import { lockLedger } from "@/lib/ledger"
import prisma from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push"

export async function updateGuestMealStatus({
  requestId,
  status,
}: {
  requestId: string
  status: GuestMealStatusType
}): Promise<ApiResponse> {
  const session = await requireManager()

  if (!session) {
    return {
      status: "error",
      message: "Unauthorized",
    }
  }

  // Approving/rejecting guest meals is an operational action reserved for the
  // Manager. MessPrefect has read/oversight access but cannot act on requests.
  if (!isManager(session.user.role)) {
    return {
      status: "error",
      message: "Only a manager can approve or reject guest meals.",
    }
  }

  const actorId = session.user.id
  if (!actorId) {
    return { status: "error", message: "Unauthorized" }
  }

  if (status === GuestMealStatusType.PENDING) {
    return { status: "error", message: "Choose to approve or reject." }
  }

  try {
    const requestedUserId = await prisma.$transaction(async (tx) => {
      // Who to bill and how much come off the request itself, never from the
      // client.
      const request = await tx.guestMeal.findUnique({
        where: { id: requestId },
        select: { userId: true, mealCharge: true },
      })
      if (!request) throw new Error("Guest meal request not found.")

      const currentDue = await lockLedger(tx, request.userId)

      // A request is decided once, while pending. Two managers on the same
      // request (or an approve racing a reject) used to both go through: a
      // double charge, or the boarder told "approved" while the row said
      // rejected. The second now waits on the row and matches nothing.
      const { count } = await tx.guestMeal.updateMany({
        where: { id: requestId, status: GuestMealStatusType.PENDING },
        data: {
          status: status,
          approvedAt: status === "APPROVED" ? new Date() : null,
          approvedBy: status === "APPROVED" ? session.user.id : null,
        },
      })
      if (count === 0) {
        throw new Error("This request has already been handled.")
      }

      // Still pending until a moment ago, so it has never been billed.
      if (status === "APPROVED") {
        await tx.userBill.create({
          data: {
            type: BillEntryType.GUEST_MEAL_CHARGE,
            amount: request.mealCharge,
            description: `Guest Meal: Your meal request was approved by ${session.user.name}.`,
            balanceRemaining: currentDue + request.mealCharge,
            issueDate: new Date(),
            guestMeal: { connect: { id: requestId } },
            user: { connect: { id: request.userId } },
          },
        })
      }
      return request.userId
    })
    prisma.notification
      .create({
        data: {
          title: "Guest Meal Update",
          message: `Your guest meal request was ${status.toLowerCase()} by ${session.user.name}! ${
            status === "APPROVED"
              ? "The guest will be served during the selected meal time."
              : `The guest will not be served during the selected meal time due to the request being ${status.toLowerCase()}.`
          }`,
          type: NotificationType.MEAL,
          user: { connect: { id: requestedUserId } },
          issuer: { connect: { id: session.user.id } },
        },
      })
      .catch((err) => {
        console.error("Notification creation failed:", err)
      })

    prisma.activityLog
      .create({
        data: {
          userId: actorId,
          actionType: "GUEST_MEAL_STATUS_CHANGE",
          entityType: "GUEST_MEAL",
          entityId: requestId,
          newData: { status, requestedUserId },
          details: `Guest meal request ${status.toLowerCase()} by ${session.user.name}.`,
        },
      })
      .catch((err) => {
        console.error("Activity log creation failed:", err)
      })

    after(() =>
      sendPushToUser(requestedUserId, {
        title:
          status === "APPROVED" ? "Guest meal approved" : "Guest meal update",
        body:
          status === "APPROVED"
            ? `Your guest meal request was approved by ${session.user.name}. Your guest will be served during the selected meal time.`
            : `Your guest meal request was ${status.toLowerCase()} by ${session.user.name}.`,
        icon: "/app-icon-192.png",
        url: "/guest-meal",
        tag: `guest-meal-${requestId}`,
      }).catch((err) => console.error("Push notification failed:", err))
    )

    return {
      status: "success",
      message: "Guest meal status updated successfully",
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
