import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "contracts",
          environment: "node",
          include: ["packages/shared/**/*.test.ts", "worker/**/*.test.ts", "tests/contracts/**/*.test.ts", "tests/eval/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts", "tests/integration/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
