-- Softswitch connects to the host on TCP 21 (active FTP). No PASV publish.
ALTER TABLE "app_settings" ALTER COLUMN "ftpListenPort" SET DEFAULT 21;
UPDATE "app_settings" SET "ftpListenPort" = 21 WHERE "ftpListenPort" = 2121;
