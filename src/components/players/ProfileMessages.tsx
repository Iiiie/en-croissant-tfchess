import { Button, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EMPTY_MESSAGES,
  IMAGE_CATEGORIES,
  type PlayerMessages,
  type PlayerProfile,
  readProfileMessages,
  writeProfileMessages,
} from "@/utils/playerProfile";

export default function ProfileMessages({ profile }: { profile: PlayerProfile }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<PlayerMessages>(EMPTY_MESSAGES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void readProfileMessages(profile.id).then(setMessages);
  }, [profile.id]);

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
      {IMAGE_CATEGORIES.map((category) => (
        <Textarea
          key={category}
          label={t(`Players.Category.${category}`)}
          minRows={3}
          autosize
          value={messages[category].join("\n")}
          onChange={(event) =>
            setMessages((prev) => ({
              ...prev,
              [category]: event.currentTarget.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            }))
          }
        />
      ))}
      <Button onClick={() => void save()} loading={saving}>
        {t("Common.Save")}
      </Button>
    </Stack>
  );
}
