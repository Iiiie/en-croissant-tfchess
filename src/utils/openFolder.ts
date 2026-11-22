import { notifications } from "@mantine/notifications";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import i18n from "@/i18n";

/**
 * Copies a folder path to the clipboard. Opening a file manager through
 * `xdg-open` is unreliable on some Linux setups (e.g. missing `qtpaths`), so
 * the buttons copy the path for pasting into the user's file manager.
 */
export async function copyFolderPath(path: string | Promise<string>): Promise<void> {
    let target = "";
    try {
        target = await path;
        await writeText(target);
        notifications.show({
            color: "green",
            title: i18n.t("Common.PathCopied"),
            message: target,
            autoClose: 6000,
        });
    } catch (error) {
        notifications.show({
            color: "red",
            title: i18n.t("Common.CopyPathFailed"),
            message: `${target}\n${String(error)}`.trim(),
            autoClose: 10000,
        });
    }
}
