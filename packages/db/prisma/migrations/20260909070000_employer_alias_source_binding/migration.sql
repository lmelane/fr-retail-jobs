ALTER TABLE "CompanyAlias" ADD COLUMN "sourceHash" TEXT;
-- Do not silently bind historical decisions to today's tenant/configuration.
-- Existing unbound reviews are explicitly refused by the resolver until reviewed.
