import {
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconEdit, IconCopy, IconPlus, IconTrash, IconUsersGroup } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import ConfirmModal from "@/components/common/ConfirmModal";
import { archetypesAtom, playerProfilesAtom } from "@/state/atoms";
import {
  type Archetype,
  deleteProfileStorage,
  ensureArchetypesStorage,
  ensureProfileStorage,
  getProfileDir,
  type PlayerProfile,
  writePlayersReadme,
} from "@/utils/playerProfile";
import { copyFolderPath } from "@/utils/openFolder";
import ArchetypesModal from "./ArchetypesModal";
import PlayerProfileCard from "./PlayerProfileCard";
import PlayerProfileModal from "./PlayerProfileModal";
import ProfileHistory from "./ProfileHistory";
import ProfileImages from "./ProfileImages";
import ProfileMessages from "./ProfileMessages";

function ProfileOverview({
  profile,
  archetypes,
}: {
  profile: PlayerProfile;
  archetypes: Archetype[];
}) {
  const { t } = useTranslation();
  const { data: folder } = useSWR(["profile-dir", profile.id], () => getProfileDir(profile.id));
  const archetypeNames = profile.archetypeIds
    .map((id) => archetypes.find((archetype) => archetype.id === id)?.name ?? id)
    .join(", ");

  return (
    <Stack>
      <SimpleGrid cols={2}>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t("Players.Elo")}
          </Text>
          <Text fz="xl" fw={700}>
            {profile.elo}
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t("Players.Vulnerability")}
          </Text>
          <Text fz="xl" fw={700}>
            {profile.vulnerability.toFixed(2)}x
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t("Players.Record")}
          </Text>
          <Text fz="xl" fw={700}>
            {profile.stats.wins} / {profile.stats.losses} / {profile.stats.draws}
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t("Players.Games")}
          </Text>
          <Text fz="xl" fw={700}>
            {profile.stats.games}
          </Text>
        </Paper>
      </SimpleGrid>

      <Group>
        <Badge>{profile.kind === "engine" ? t("Players.Engine") : t("Players.Human")}</Badge>
        {profile.kind === "engine" && (
          <Text size="sm" c="dimmed">
            {profile.engineId ? t("Players.EngineLinked") : t("Players.NoEngine")}
          </Text>
        )}
      </Group>

      <Divider label={t("Players.Archetypes")} />
      <Text size="sm">{archetypeNames || t("Players.Archetypes.None")}</Text>

      <Divider label={t("Players.Folder")} />
      <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
        {folder ?? "…"}
      </Text>

      <Divider label={t("Players.Notes")} />
      <Text style={{ whiteSpace: "pre-wrap" }}>{profile.notes || t("Players.NoNotes")}</Text>
    </Stack>
  );
}

export default function PlayersPage() {
  const { t } = useTranslation();
  const [profilesValue, setProfiles] = useAtom(playerProfilesAtom);
  const profiles = useMemo(() => profilesValue ?? [], [profilesValue]);
  const [archetypesValue] = useAtom(archetypesAtom);
  const archetypes = useMemo(() => archetypesValue ?? [], [archetypesValue]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [archetypesOpen, setArchetypesOpen] = useState(false);
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlayerProfile | null>(null);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null;

  useEffect(() => {
    void ensureArchetypesStorage(archetypes);
    for (const profile of profiles) {
      void ensureProfileStorage(profile);
    }
    void writePlayersReadme(profiles, archetypes);
  }, [profiles, archetypes]);

  const copyFolder = (profile: PlayerProfile) => {
    void copyFolderPath(getProfileDir(profile.id));
  };

  const add = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const edit = (profile: PlayerProfile) => {
    setEditing(profile);
    setModalOpen(true);
  };

  const remove = async (profile: PlayerProfile) => {
    setProfiles(async (prev) => {
      const list = await prev;
      return list.filter((item) => item.id !== profile.id);
    });
    await deleteProfileStorage(profile.id);
    if (selectedId === profile.id) {
      setSelectedId(null);
    }
    setDeleteTarget(null);
  };

  return (
    <Group grow align="start" h="100%" p="md" style={{ overflow: "hidden" }}>
      <Paper withBorder h="100%" style={{ overflow: "hidden" }}>
        <Stack h="100%" gap={0}>
          <Group p="xs" justify="space-between">
            <Title order={3}>{t("Players.Title")}</Title>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconUsersGroup size="1rem" />}
                onClick={() => setArchetypesOpen(true)}
              >
                {t("Players.Archetypes")}
              </Button>
              <Button leftSection={<IconPlus size="1rem" />} onClick={add}>
                {t("Common.AddNew")}
              </Button>
            </Group>
          </Group>
          <ScrollArea style={{ flex: 1 }}>
            <Stack p="xs">
              {profiles.map((profile) => (
                <PlayerProfileCard
                  key={profile.id}
                  profile={profile}
                  selected={profile.id === selected?.id}
                  onSelect={setSelectedId}
                />
              ))}
              {profiles.length === 0 && (
                <Text c="dimmed" ta="center">
                  {t("Players.Empty")}
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Stack>
      </Paper>

      <Paper withBorder h="100%" p="md" style={{ overflow: "hidden" }}>
        {selected ? (
          <Stack h="100%" style={{ overflow: "hidden" }}>
            <Group justify="space-between">
              <Title order={3}>{selected.name}</Title>
              <Group>
                <Button
                  variant="default"
                  leftSection={<IconCopy size="1rem" />}
                  onClick={() => void copyFolder(selected)}
                >
                  {t("Common.CopyFolderPath")}
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconEdit size="1rem" />}
                  onClick={() => edit(selected)}
                >
                  {t("Common.Edit")}
                </Button>
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size="1rem" />}
                  onClick={() => setDeleteTarget(selected)}
                >
                  {t("Common.Delete")}
                </Button>
              </Group>
            </Group>

            <Tabs defaultValue="overview" style={{ flex: 1, overflow: "hidden" }}>
              <Tabs.List>
                <Tabs.Tab value="overview">{t("Players.Overview")}</Tabs.Tab>
                <Tabs.Tab value="images">{t("Players.Images")}</Tabs.Tab>
                <Tabs.Tab value="messages">{t("Players.Messages")}</Tabs.Tab>
                <Tabs.Tab value="history">{t("Players.History")}</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="overview" pt="md">
                <ProfileOverview profile={selected} archetypes={archetypes} />
              </Tabs.Panel>
              <Tabs.Panel value="images" pt="md">
                <ProfileImages profile={selected} />
              </Tabs.Panel>
              <Tabs.Panel value="messages" pt="md">
                <ProfileMessages profile={selected} />
              </Tabs.Panel>
              <Tabs.Panel value="history" pt="md">
                <ProfileHistory profile={selected} />
              </Tabs.Panel>
            </Tabs>
          </Stack>
        ) : (
          <Center h="100%">
            <Text c="dimmed">{t("Players.SelectProfile")}</Text>
          </Center>
        )}
      </Paper>

      {modalOpen && (
        <PlayerProfileModal
          opened={modalOpen}
          onClose={() => setModalOpen(false)}
          profile={editing}
        />
      )}

      <ArchetypesModal opened={archetypesOpen} onClose={() => setArchetypesOpen(false)} />

      <ConfirmModal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
        title={t("Players.Delete.Title")}
        description={t("Players.Delete.Desc", {
          name: deleteTarget?.name ?? "",
        })}
      />
    </Group>
  );
}
