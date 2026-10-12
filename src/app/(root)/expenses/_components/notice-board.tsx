"use client"

import { useEffect, useState } from "react"
import {
  Basket,
  CalendarCheck,
  Carrot,
  ChartPieSlice,
  CookingPot,
  DotsThreeOutline,
  Fish,
  Grains,
  PushPin,
  Receipt,
  TrendDown,
  TrendUp,
  UsersThree,
  Wallet,
} from "@phosphor-icons/react"
import {
  animate,
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
  type Variants,
} from "motion/react"

import { cn } from "@/lib/utils"

import type { BillNotice } from "../_lib/actions"

// Same names the prefect fills in on the billing page.
const CATEGORIES = [
  { key: "rice", label: "Rice", icon: Grains, color: "var(--chart-1)" },
  {
    key: "vegetables",
    label: "Vegetables",
    icon: Carrot,
    color: "var(--chart-2)",
  },
  { key: "fish", label: "Fish / Meat", icon: Fish, color: "var(--chart-3)" },
  { key: "grocery", label: "Grocery", icon: Basket, color: "var(--chart-4)" },
  {
    key: "daily",
    label: "Daily / Misc.",
    icon: CookingPot,
    color: "var(--chart-5)",
  },
  {
    key: "other",
    label: "Other",
    icon: DotsThreeOutline,
    color: "var(--muted-foreground)",
  },
] as const

const EASE_OUT = [0.22, 1, 0.36, 1] as const

function inr(amount: number, digits = 0) {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

export function NoticeBoard({
  notices,
  myShare,
}: {
  notices: BillNotice[]
  myShare: Record<string, number>
}) {
  const [selectedId, setSelectedId] = useState(notices[0]?.id)
  const index = Math.max(
    0,
    notices.findIndex((n) => n.id === selectedId)
  )
  const notice = notices[index]

  return (
    // "user": transforms fall back to fades for anyone who asked their OS for
    // less motion.
    <MotionConfig reducedMotion="user">
      <section className="bg-muted/40 relative overflow-hidden rounded-xl border p-4 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px]"
        />
        <div className="relative">
          <div className="mb-5 flex items-center gap-2">
            <PushPin weight="fill" className="text-primary size-4" />
            <h2 className="text-sm font-semibold tracking-wide uppercase">
              Notice board
            </h2>
            {notices.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                · {notices.length} {notices.length === 1 ? "bill" : "bills"}{" "}
                published
              </span>
            ) : null}
          </div>

          {notice ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="min-w-0 lg:order-last">
                <NoticeSlips
                  notices={notices}
                  selectedId={notice.id}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="min-w-0">
                <AnimatePresence mode="wait">
                  <BillNoticeCard
                    key={notice.id}
                    notice={notice}
                    previous={notices[index + 1]}
                    share={myShare[notice.id]}
                    isLatest={index === 0}
                  />
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <EmptyNotice />
          )}
        </div>
      </section>
    </MotionConfig>
  )
}

function Pin({
  delay = 0,
  small = false,
}: {
  delay?: number
  small?: boolean
}) {
  return (
    <motion.span
      aria-hidden
      initial={{ y: -16, scale: 1.5, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 16, delay }}
      style={{ x: "-50%" }}
      className={cn(
        "bg-primary ring-background absolute left-1/2 rounded-full shadow-md ring-2",
        small ? "-top-1.5 size-3" : "-top-2 size-4"
      )}
    />
  )
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: -28, rotate: -3 },
  shown: {
    opacity: 1,
    y: 0,
    rotate: -0.4,
    transition: { type: "spring", stiffness: 240, damping: 22 },
  },
  gone: { opacity: 0, y: 18, rotate: 1.5, transition: { duration: 0.18 } },
}

function BillNoticeCard({
  notice,
  previous,
  share,
  isLatest,
}: {
  notice: BillNotice
  previous?: BillNotice
  share?: number
  isLatest: boolean
}) {
  const rows = CATEGORIES.map((c) => ({ ...c, amount: notice[c.key] })).filter(
    (r) => r.amount > 0
  )

  return (
    <motion.article
      variants={cardVariants}
      initial="hidden"
      animate="shown"
      exit="gone"
      className="bg-card text-card-foreground relative origin-top rounded-lg border p-5 shadow-lg sm:p-7"
    >
      <Pin delay={0.15} />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs tracking-widest uppercase">
            <Receipt weight="duotone" className="size-4" />
            Mess bill
          </p>
          <h3 className="mt-1 text-2xl font-bold sm:text-3xl">
            {notice.month}
          </h3>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <CalendarCheck className="size-3.5 shrink-0" />
            Published {notice.publishedOn}
            {notice.publishedBy ? ` by ${notice.publishedBy}` : ""}
          </p>
        </div>
        {isLatest ? (
          <motion.span
            initial={{ scale: 2.2, opacity: 0, rotate: -24 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 14,
              delay: 0.45,
            }}
            className="border-primary text-primary shrink-0 rounded border-2 px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase"
          >
            Latest
          </motion.span>
        ) : null}
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <UsersThree weight="duotone" className="size-4" />
            Per boarder
          </p>
          <p className="mt-2 text-4xl leading-none font-extrabold tabular-nums sm:text-5xl">
            <CountUp value={notice.perHead} digits={2} />
          </p>
          {previous ? <Change notice={notice} previous={previous} /> : null}
        </div>
        <div className="bg-muted/60 rounded-md border border-dashed px-4 py-3">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Wallet weight="duotone" className="size-4" />
            Your share
          </p>
          {share !== undefined ? (
            <p className="text-xl font-bold tabular-nums">{inr(share, 2)}</p>
          ) : (
            <p className="text-sm">Not billed to you this month</p>
          )}
        </div>
      </div>

      <div className="mt-7">
        <p className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          <ChartPieSlice weight="duotone" className="size-4" />
          Where it went
        </p>
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const pct = notice.total > 0 ? (row.amount / notice.total) * 100 : 0
            const Icon = row.icon
            return (
              <li key={row.key} className="flex items-center gap-3">
                <motion.span
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 16,
                    delay: 0.25 + i * 0.08,
                  }}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: `color-mix(in oklab, ${row.color} 16%, transparent)`,
                    color: row.color,
                  }}
                >
                  <Icon weight="duotone" className="size-5" />
                </motion.span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{row.label}</span>
                    <span className="tabular-nums">
                      {inr(row.amount)}{" "}
                      <span className="text-muted-foreground text-xs">
                        {pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="bg-muted mt-1.5 h-2 overflow-hidden rounded-full">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: row.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{
                        delay: 0.3 + i * 0.08,
                        duration: 0.8,
                        ease: EASE_OUT,
                      }}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <p className="text-muted-foreground mt-7 border-t border-dashed pt-4 text-xs leading-relaxed">
        {inr(notice.total)} spent
        {notice.adjustment !== 0
          ? ` ${notice.adjustment > 0 ? "+" : "−"} ${inr(
              Math.abs(notice.adjustment)
            )} adjustment`
          : ""}{" "}
        ÷ {notice.boarders} boarders ={" "}
        <span className="text-foreground font-semibold">
          {inr(notice.perHead, 2)}
        </span>{" "}
        each
      </p>
    </motion.article>
  )
}

/** Per-head change against the month before; costing more is the bad news. */
function Change({
  notice,
  previous,
}: {
  notice: BillNotice
  previous: BillNotice
}) {
  const diff = notice.perHead - previous.perHead
  if (Math.abs(diff) < 0.005) {
    return (
      <p className="text-muted-foreground mt-1 text-xs">
        Same as {previous.shortMonth}
      </p>
    )
  }
  const up = diff > 0
  const Icon = up ? TrendUp : TrendDown
  return (
    <motion.p
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.9 }}
      className={cn(
        "mt-1 flex items-center gap-1 text-xs font-medium",
        up ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
      )}
    >
      <Icon weight="bold" className="size-3.5" />
      {inr(Math.abs(diff), 2)} {up ? "more" : "less"} than {previous.shortMonth}
    </motion.p>
  )
}

function CountUp({ value, digits = 0 }: { value: number; digits?: number }) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (reduceMotion) return
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE_OUT,
      onUpdate: setShown,
    })
    return () => controls.stop()
  }, [value, reduceMotion])

  return <>{inr(reduceMotion ? value : shown, digits)}</>
}

const slipList: Variants = {
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}

const slip: Variants = {
  hidden: { opacity: 0, y: -14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 22 },
  },
}

/** Every published month as a small pinned slip; picking one swaps the notice. */
function NoticeSlips({
  notices,
  selectedId,
  onSelect,
}: {
  notices: BillNotice[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        All notices
      </p>
      <motion.ul
        variants={slipList}
        initial="hidden"
        animate="shown"
        className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-3 pb-2 lg:flex-col lg:overflow-visible"
      >
        {notices.map((n, i) => {
          const selected = n.id === selectedId
          return (
            <motion.li
              key={n.id}
              variants={slip}
              className="w-36 shrink-0 snap-start lg:w-auto"
            >
              <motion.button
                type="button"
                onClick={() => onSelect(n.id)}
                aria-pressed={selected}
                style={{ rotate: i % 2 ? 1.2 : -1.2 }}
                whileHover={{ y: -3, rotate: 0 }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "bg-card relative w-full rounded-md border p-3 pt-4 text-left shadow-sm transition-colors",
                  selected
                    ? "border-primary ring-primary/30 ring-2"
                    : "hover:border-foreground/20"
                )}
              >
                <Pin small delay={0.2 + i * 0.06} />
                <span className="text-muted-foreground block text-[11px] tracking-wide uppercase">
                  {n.month}
                </span>
                <span className="mt-0.5 block font-bold tabular-nums">
                  {inr(n.perHead, 2)}
                </span>
                <span className="text-muted-foreground block text-[11px]">
                  {inr(n.total)} spent
                </span>
              </motion.button>
            </motion.li>
          )
        })}
      </motion.ul>
    </div>
  )
}

function EmptyNotice() {
  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="shown"
      className="bg-card relative mx-auto max-w-sm rounded-lg border p-8 text-center shadow-md"
    >
      <Pin delay={0.15} />
      <Receipt className="text-muted-foreground mx-auto size-8" />
      <p className="mt-3 font-semibold">No bills published yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        When the mess prefect finalizes a month, its bill goes up here with
        where every rupee went.
      </p>
    </motion.div>
  )
}
