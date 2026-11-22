import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCopy, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmModal from "@/components/common/ConfirmModal";
import { archetypesAtom, playerProfilesAtom } from "@/state/atoms";
import {
  DEFAULT_ARCHETYPE_ID,
  deleteArchetypeStorage,
  ensureArchetypeStorage,
  getArchetypeDir,
  type Archetype,
} from "@/utils/playerProfile";
import { copyFolderPath } from "@/utils/openFolder";

export default function ArchetypesModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [archetypesValue, setArchetypes] = useAtom(archetypesAtom);
  const [, setProfiles] = useAtom(playerProfilesAtom);
  const archetypes = archetypesValue ?? [];
  const [deleteTarget, setDeleteTarget] = useState<Archetype | null>(null);

  const add = () => {
    const archetype: Archetype = {
      id: crypto.randomUUID(),
      name: t("Players.Archetypes.NewName"),
    };
    setArchetypes(async (prev) => {
      const list = await prev;
      return [...list, archetype];
    });
    void ensureArchetypeStorage(archetype);
  };

  const rename = (id: string, name: string) => {
    setArchetypes(async (prev) => {
      const list = await prev;
      return list.map((archetype) => (archetype.id === id ? { ...archetype, name } : archetype));
    });
  };

  const copyFolder = (archetype: Archetype) => {
    void copyFolderPath(getArchetypeDir(archetype.id));
  };

  const remove = async (archetype: Archetype) => {
    setArchetypes(async (prev) => {
      const list = await prev;
      return list.filter((item) => item.id !== archetype.id);
    });
    setProfiles(async (prev) => {
      const list = await prev;
      return list.map((profile) => ({
        ...profile,
        archetypeIds: profile.archetypeIds.filter((id) => id !== archetype.id),
      }));
    });
    await deleteArchetypeStorage(archetype.id);
    setDeleteTarget(null);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("Players.Archetypes")} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Players.Archetypes.Desc")}
        </Text>

        {archetypes.map((archetype) => (
          <Group key={archetype.id} wrap="nowrap" align="flex-start">
            <TextInput
              style={{ flex: 1 }}
              value={archetype.name}
              onChange={(event) => rename(archetype.id, event.currentTarget.value)}
            />
            {archetype.id === DEFAULT_ARCHETYPE_ID && (
              <Badge variant="light">{t("Players.Archetypes.Default")}</Badge>
            )}
            <Tooltip label={t("Common.CopyFolderPath")}>
              <ActionIcon onClick={() => void copyFolder(archetype)}>
                <IconCopy size="1rem" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Common.Delete")}>
              <ActionIcon
                color="red"
                disabled={archetype.id === DEFAULT_ARCHETYPE_ID}
                onClick={() => setDeleteTarget(archetype)}
              >
                <IconTrash size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}

        <Button leftSection={<IconPlus size="1rem" />} onClick={add}>
          {t("Players.Archetypes.Add")}
        </Button>
      </Stack>

      <ConfirmModal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
        title={t("Players.Archetypes.Delete.Title")}
        description={t("Players.Archetypes.Delete.Desc", {
          name: deleteTarget?.name ?? "",
        })}
      />
    </Modal>
  );
}
