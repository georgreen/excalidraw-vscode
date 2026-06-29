import { defineConfig } from "vitest/config";
import * as path from "path";

// Unit tests for the host code run in plain Node and alias the `vscode` module
// to a lightweight mock (src/test/vscode.mock.ts), so resolvers can be tested
// with stubbed language-server commands.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^vscode$/,
        replacement: path.resolve(__dirname, "src/test/vscode.mock.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
