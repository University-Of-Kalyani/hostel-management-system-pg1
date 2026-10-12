import { unstable_noStore as noStore } from "next/cache"
import { Receipt } from "@phosphor-icons/react/ssr"

import { PageContainer, PageHeader } from "@/components/page-container"

import { NoticeBoard } from "./_components/notice-board"
import { getExpenseBoard } from "./_lib/actions"

export default async function ExpensesPage() {
  noStore()
  const { notices, myShare } = await getExpenseBoard()

  return (
    <PageContainer>
      <PageHeader
        icon={Receipt}
        title="Expenses"
        description="Where the mess money went each month, as published by the mess prefect."
      />
      <NoticeBoard notices={notices} myShare={myShare} />
    </PageContainer>
  )
}
