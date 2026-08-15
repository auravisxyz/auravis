import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Auravis",
    description:
      "Point at anything, say what you want, and let an agent act within a limit it cannot exceed.",
    // activeTab + scripting means we only read a page when the user explicitly
    // opens the popup and captures. No background surveillance of browsing.
    permissions: ["activeTab", "scripting", "storage"],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
