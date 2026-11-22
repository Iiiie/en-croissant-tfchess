import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getDatabasesDir, getEnginesDir, getPlayersDir, getPuzzlesDir } from "@/utils/directories";
import { copyFolderPath } from "@/utils/openFolder";

function OpenFolderButton({
  base,
  folder,
}: {
  base?: "Database" | "Document" | "Engines" | "Players" | "Puzzles";
  folder: string;
}) {
  const { t } = useTranslation();

  async function openAppDirData() {
    let dir = folder;
    if (base === "Database") {
      dir = await getDatabasesDir();
    }
    if (base === "Engines") {
      dir = await getEnginesDir();
    }
    if (base === "Puzzles") {
      dir = await getPuzzlesDir();
    }
    if (base === "Players") {
      dir = await getPlayersDir();
    }
    await copyFolderPath(dir);
  }
  return (
    <Tooltip label={t("Common.CopyFolderPath")}>
      <ActionIcon onClick={() => void openAppDirData()}>
        <IconCopy size="1.5rem" />
      </ActionIcon>
    </Tooltip>
  );
}

export default OpenFolderButton;
