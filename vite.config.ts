import { defineConfig } from "vp";

// vendor/ holds third-party build output, checked in as built and re-vendored, never edited.
export default defineConfig({
  fmt: { ignorePatterns: ["vendor/**"] },
  lint: { ignorePatterns: ["vendor/**"] },
});
