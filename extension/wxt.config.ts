import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Auravis",
    description:
      "Point at anything, say what you want, and let an agent act within a limit it cannot exceed.",
    // activeTab + scripting: pages are only read when the user opens the popup
    // and captures. No background surveillance of browsing.
    //
    // alarms + notifications: re-check watched pages on a schedule and tell the
    // user when something moves.
    permissions: ["activeTab", "scripting", "storage", "alarms", "notifications"],

    // Requested per-site at the moment a watch is created, never up front.
    // Re-checking has to happen from the user's own browser — their session,
    // region and account pricing — but that's no reason to hold blanket access
    // to every site they visit. They grant one origin, for one thing they asked
    // us to watch, and can revoke it.
    optional_host_permissions: ["*://*/*"],

    icons: {
      16: "/icon/16.png",
      32: "/icon/32.png",
      48: "/icon/48.png",
      128: "/icon/128.png",
    },
    action: {
      default_icon: {
        16: "/icon/16.png",
        32: "/icon/32.png",
      },
    },
  },
  vite: () => ({
    // Cast: @tailwindcss/vite is typed against the workspace's vite while WXT
    // types its config against its own bundled copy. Identical runtime, two
    // nominal Plugin types. Type-level noise only.
    plugins: [tailwindcss() as never],
  }),
});
