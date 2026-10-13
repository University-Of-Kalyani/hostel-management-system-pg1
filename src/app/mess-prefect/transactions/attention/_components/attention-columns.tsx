"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import type { ColumnDef } from "@tanstack/react-table"

import { formatIST } from "@/lib/date"
import type { UserRoleType } from "@/lib/generated/prisma"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/reui/badge"
import { RecordPaymentDialog } from "@/app/manager/users/_components/user-detail-header"

import type { AttentionRow, AttentionType } from "../_lib/validations"

/** MESS_PREFECT -> "Mess prefect". */
export function roleLabel(role: UserRoleType) {
  const words = role.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function formatMoney(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "B"
  )
}

export function getColumns(type: AttentionType): ColumnDef<AttentionRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all boarders on this page"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Select ${row.original.name}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Boarder" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar size="sm">
            <AvatarImage
              src={row.original.image ?? undefined}
              alt={row.original.name}
            />
            <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.original.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {row.original.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Role" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {roleLabel(row.original.role)}
        </span>
      ),
    },
    {
      accessorKey: "overdueCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Overdue bills" />
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.overdueCount || "—"}
        </span>
      ),
    },
    {
      accessorKey: "daysOverdue",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Age" />
      ),
      cell: ({ row }) => {
        const days = row.original.daysOverdue
        if (days <= 0) {
          return <span className="text-muted-foreground text-sm">—</span>
        }
        return (
          <Badge
            variant={
              days >= 60
                ? "destructive-light"
                : days >= 30
                  ? "warning-light"
                  : "secondary"
            }
            size="sm"
          >
            {days}d overdue
          </Badge>
        )
      },
    },
    {
      accessorKey: "oldestDueDate",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Oldest unpaid" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {row.original.oldestDueDate
            ? formatIST(row.original.oldestDueDate)
            : "—"}
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "amount",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={type === "overdue" ? "Overdue amount" : "Outstanding"}
        />
      ),
      cell: ({ row }) => (
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            row.original.amount > 0 && "text-destructive"
          )}
        >
          {formatMoney(row.original.amount)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      // Alumni leave the users list on transfer, so this is the only place
      // their payments can be recorded; boarders are paid from their profile.
      // Same action as the profile page: it locks the ledger and builds on
      // the current balance.
      cell: ({ row }) =>
        row.original.group === "alumni" ? (
          <RecordPaymentCell row={row.original} />
        ) : null,
      enableSorting: false,
      enableHiding: false,
    },
  ]
}

function RecordPaymentCell({ row }: { row: AttentionRow }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        Record payment
      </Button>
      <RecordPaymentDialog
        userId={row.userId}
        currentDue={row.outstanding}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
