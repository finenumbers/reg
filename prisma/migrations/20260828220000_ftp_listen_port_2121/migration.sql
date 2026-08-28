-- Host TCP 21 is often already taken; listen on 2121 instead.
ALTER TABLE "app_settings" ALTER COLUMN "ftpListenPort" SET DEFAULT 2121;
UPDATE "app_settings" SET "ftpListenPort" = 2121 WHERE "ftpListenPort" = 21;
