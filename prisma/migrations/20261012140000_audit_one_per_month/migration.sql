-- One audit per month. Two first saves of a month at once could each create
-- one; prod has exactly one per month, each dated the 1st, so this applies.
-- CreateIndex
CREATE UNIQUE INDEX "audits_date_key" ON "audits"("date");
