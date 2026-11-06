import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  minify: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // Optional native dependency, loaded lazily by optimize_image only.
  external: ["sharp"],
  banner: {},
});
