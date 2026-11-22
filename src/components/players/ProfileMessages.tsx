import {
  Accordion,
  Badge,
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DifferenceMessages,
  EMPTY_MESSAGES,
  type PlayerMessages,
  type PlayerProfile,
  readProfileMessages,
  writeProfileMessages,
} from "@/utils/playerProfile";

type OutcomeType = "WIN" | "LOSS";

export default function ProfileMessages({ profile }: { profile: PlayerProfile }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<PlayerMessages>(EMPTY_MESSAGES);
  const [type, setType] = useState<OutcomeType>("LOSS");
  const [newDifference, setNewDifference] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void readProfileMessages(profile.id).then(setMessages);
  }, [profile.id]);

  const lists: DifferenceMessages = messages[type];
  const keys = Object.keys(lists).sort((a, b) => Number(a) - Number(b));

  const addList = () => {
    const key = String(Math.max(0, Math.min(103, Math.round(newDifference))));
    setMessages((prev) => ({
      ...prev,
      [type]: { ...prev[type], [key]: prev[type][key] ?? [] },
    }));
  };

  const removeList = (key: string) => {
    setMessages((prev) => {
      const next = { ...prev[type] };
      delete next[key];
      return { ...prev, [type]: next };
    });
  };

  const updateList = (key: string, value: string) => {
    const list = value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    setMessages((prev) => ({
      ...prev,
      [type]: { ...prev[type], [key]: list },
    }));
  };

  const save = async () => {
    setSaving(true);
    await writeProfileMessages(profile.id, messages);
    setSaving(false);
    notifications.show({
      message: t("Common.Saved"),
      color: "green",
    });
  };

  return (
    <Stack>
      <Text size="xs" c="dimmed">
        {t("Players.MessagesHint")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("Players.ProfileMessagesHint")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("Players.MessagesFallbackHint")}
      </Text>

      <SegmentedControl
        value={type}
        onChange={(value) => setType(value as OutcomeType)}
        data={[
          { value: "WIN", label: t("Players.Category.WIN") },
          { value: "LOSS", label: t("Players.Category.LOSS") },
        ]}
      />

      <Group align="flex-end">
        <NumberInput
          label={t("Players.MessageDifference")}
          min={0}
          max={103}
          value={newDifference}
          onChange={(value) =>
            setNewDifference(typeof value === "number" ? value : Number.parseInt(value, 10) || 0)
          }
        />
        <Button leftSection={<IconPlus size="1rem" />} onClick={addList}>
          {t("Players.AddMessageList")}
        </Button>
      </Group>

      {keys.length === 0 ? (
        <Text c="dimmed">{t("Players.NoMessageLists")}</Text>
      ) : (
        <Accordion variant="separated">
          {keys.map((key) => (
            <Accordion.Item key={key} value={key}>
              <Accordion.Control>
                <Group justify="space-between">
                  <Text fw={600}>{t("Players.MessageDifferenceValue", { difference: key })}</Text>
                  <Badge variant="light">{lists[key].length}</Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack>
                  <Textarea
                    minRows={3}
                    autosize
                    value={lists[key].join("\n")}
                    onChange={(event) => updateList(key, event.currentTarget.value)}
                  />
                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size="1rem" />}
                    onClick={() => removeList(key)}
                  >
                    {t("Players.RemoveMessageList")}
                  </Button>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      <Button onClick={() => void save()} loading={saving}>
        {t("Common.Save")}
      </Button>
    </Stack>
  );
}
