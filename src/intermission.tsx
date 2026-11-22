import { MantineProvider, v8CssVariablesResolver } from "@mantine/core";
import { createRoot } from "react-dom/client";

import "@mantine/core/styles.css";
import "@/styles/global.css";
import "./i18n";

import IntermissionWindow from "@/components/roleplay/IntermissionWindow";
import { getIntermissionPayload } from "@/components/roleplay/intermissionWindow";
import { colorSchemeManager, createAppTheme } from "@/theme";

const payload = getIntermissionPayload();
const container = document.getElementById("app");

if (container) {
  if (payload) {
    document.documentElement.style.fontSize = `${payload.fontSize}%`;
    document.title = payload.title;
  }

  createRoot(container).render(
    <MantineProvider
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
      theme={createAppTheme(payload?.primaryColor ?? "blue")}
      cssVariablesResolver={v8CssVariablesResolver}
    >
      <IntermissionWindow payload={payload} />
    </MantineProvider>,
  );
}
