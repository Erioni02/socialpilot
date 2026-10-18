import { defineConfig } from "tsup";

/**
 * Production bundle: workspace packages and pure-JS deps are bundled; native or file-reading packages stay external
 * and are declared in this app's package.json (Prisma engines, Sharp, argon2, BullMQ Lua scripts, pg).
 */
const EXTERNAL = ["@prisma/client", ".prisma", "sharp", "@node-rs/argon2", "bullmq", "ioredis", "pg", "pg-native"];
const isExternal = (id: string) => EXTERNAL.some((e) => id === e || id.startsWith(`${e}/`));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^(?!@prisma\/client|\.prisma|sharp|@node-rs\/argon2|bullmq|ioredis|pg).*/],
  esbuildPlugins: [
    {
      name: "externals",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => (isExternal(args.path) ? { path: args.path, external: true } : undefined));
      },
    },
  ],
  banner: {
    js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __f } from 'url'; import { dirname as __d } from 'path'; const require = __cr(import.meta.url); const __filename = __f(import.meta.url); const __dirname = __d(__filename);",
  },
});
