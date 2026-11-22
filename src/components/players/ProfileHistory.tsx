import {
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import {
  type PlayerProfile,
  type ProfileGameRecord,
  readProfileHistory,
} from "@/utils/playerProfile";

export default function ProfileHistory({ profile }: { profile: PlayerProfile }) {
  const { t } = useTranslation();
  const { data: history = [], isLoading } = useSWR<ProfileGameRecord[]>(
    ["profile-history", profile.id, profile.updatedAt],
    () => readProfileHistory(profile.id),
  );
  const [selected, setSelected] = useState<ProfileGameRecord | null>(null);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const navigate = useNavigate();

  const openGame = async (record: ProfileGameRecord) => {
    await createTab({
      tab: {
        name: `${record.opponentName} (${record.result})`,
        type: "analysis",
      },
      pgn: record.pgn,
      setTabs,
      setActiveTab,
    });
    await navigate({ to: "/" });
  };

  if (isLoading) {
    return <Loader />;
  }

  if (history.length === 0) {
    return <Text c="dimmed">{t("Players.NoHistory")}</Text>;
  }

  return (
    <Stack>
      <ScrollArea h={420}>
        <Table highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Players.Date")}</Table.Th>
              <Table.Th>{t("Players.Opponent")}</Table.Th>
              <Table.Th>{t("Players.Color")}</Table.Th>
              <Table.Th>{t("Players.Result")}</Table.Th>
              <Table.Th>{t("Players.Elo")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.map((record) => (
              <Table.Tr key={record.id}>
                <Table.Td>{new Date(record.startedAt).toLocaleDateString()}</Table.Td>
                <Table.Td>{record.opponentName}</Table.Td>
                <Table.Td>{record.color}</Table.Td>
                <Table.Td>
                  <Badge
                    size="sm"
                    color={
                      record.playerScore === 1 ? "green" : record.playerScore === 0 ? "red" : "gray"
                    }
                  >
                    {record.result}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {record.eloBefore} → {record.eloAfter}
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => setSelected(record)}>
                    {t("Players.View")}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Modal
        opened={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.opponentName} (${selected.result})` : undefined}
        size="lg"
      >
        {selected && (
          <Stack>
            <Group>
              <Badge>{selected.color}</Badge>
              <Text size="sm">{selected.timeControl}</Text>
              <Text size="sm">
                Elo {selected.eloBefore} → {selected.eloAfter}
              </Text>
            </Group>
            <Divider label={t("Roleplay.Chat")} />
            <ScrollArea h={180}>
              <Stack gap={4}>
                {selected.chat.map((message) => (
                  <Text
                    key={message.id}
                    size="sm"
                    c={message.kind === "system" ? "dimmed" : undefined}
                  >
                    {message.kind === "system"
                      ? message.text
                      : `${message.authorName}: ${message.text}`}
                  </Text>
                ))}
              </Stack>
            </ScrollArea>
            <Divider label={t("Roleplay.Intermission")} />
            <ScrollArea h={160}>
              <Stack gap={4}>
                {selected.intermissions.map((intermission) => (
                  <Text key={intermission.id} size="sm">
                    {intermission.san} · {intermission.white.profileName} /{" "}
                    {intermission.black.profileName} ·{" "}
                    {Math.round(intermission.white.durationMs / 100) / 10}s /{" "}
                    {Math.round(intermission.black.durationMs / 100) / 10}s
                  </Text>
                ))}
              </Stack>
            </ScrollArea>
            <Group justify="right">
              <Button onClick={() => void openGame(selected)}>{t("Players.OpenInAnalysis")}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
