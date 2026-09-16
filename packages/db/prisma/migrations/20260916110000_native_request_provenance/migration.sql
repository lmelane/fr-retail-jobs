-- Historical captures remain unknown. Only new observations require a private envelope.
ALTER TABLE "RawCapture" ADD COLUMN "requestDataHash" TEXT;
ALTER TABLE "RawCapture" ADD CONSTRAINT "RawCapture_requestDataHash_fkey"
  FOREIGN KEY ("requestDataHash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "RawCapture_requestDataHash_idx" ON "RawCapture"("requestDataHash");
CREATE FUNCTION require_native_request_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestDataHash" IS NULL THEN
    RAISE EXCEPTION 'New capture requires native request data (unknown transport must be explicit)';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RawCapture_require_request_data" BEFORE INSERT ON "RawCapture"
FOR EACH ROW EXECUTE FUNCTION require_native_request_data();
