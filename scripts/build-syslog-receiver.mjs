import { build } from "esbuild";

await build({
  entryPoints: ["src/modules/smg-syslog/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/smg-syslog-receiver.cjs",
  external: ["pg"],
  alias: { "@": "./src" },
  target: "node22",
  logLevel: "info",
});
