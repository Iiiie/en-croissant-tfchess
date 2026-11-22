import {
  Badge,
  Button,
  Drawer,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useRoleplayGame } from "@/hooks/useRoleplayGame";
import { currentPlayersAtom } from "@/state/atoms";
import type { ChatMessage, GameSide } from "@/utils/playerProfile";

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.kind === "system") {
    return (
      <Text c="dimmed" size="xs" ta="center">
        {message.text}
      </Text>
    );
  }

  return (
    <Paper
      withBorder
      p="xs"
      bg={
        message.authorSide === "white"
          ? "var(--mantine-color-gray-light)"
          : "var(--mantine-color-dark-light)"
      }
    >
      <Group justify="space-between">
        <Badge size="xs" color={message.authorSide === "white" ? "gray" : "dark"}>
          {message.authorName}
        </Badge>
        <Text size="xs" c="dimmed">
          {new Date(message.timestamp).toLocaleTimeString()}
        </Text>
      </Group>
      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
        {message.text}
      </Text>
    </Paper>
  );
}

export default function ChatDrawer({
  opened,
  onClose,
  roleplay,
  gameState,
}: {
  opened: boolean;
  onClose: () => void;
  roleplay: ReturnType<typeof useRoleplayGame>;
  gameState: "settingUp" | "playing" | "gameOver";
}) {
  const { t } = useTranslation();
  const players = useAtomValue(currentPlayersAtom);
  const [side, setSide] = useState<GameSide>("white");
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (opened) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [opened, roleplay.chat.length]);

  const whiteName =
    players.white.name ??
    (players.white.type === "engine" ? players.white.engine?.name : "White") ??
    "White";
  const blackName =
    players.black.name ??
    (players.black.type === "engine" ? players.black.engine?.name : "Black") ??
    "Black";

  const send = () => {
    roleplay.sendChat(side, text);
    setText("");
  };

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="md" title={t("Roleplay.Chat")}>
      <Stack h="100%" gap="sm">
        <Group justify="space-between">
          <SegmentedControl
            value={side}
            onChange={(value) => setSide(value as GameSide)}
            data={[
              { value: "white", label: whiteName },
              { value: "black", label: blackName },
            ]}
          />
          <Button
            size="xs"
            variant={roleplay.isPaused ? "filled" : "light"}
            onClick={() => void roleplay.togglePause()}
            disabled={!!roleplay.active}
          >
            {roleplay.isPaused ? t("Board.Resume") : t("Board.Pause")}
          </Button>
        </Group>

        <ScrollArea style={{ flex: 1 }} viewportRef={scrollRef} offsetScrollbars>
          <Stack gap="xs">
            {roleplay.chat.length === 0 && (
              <Text c="dimmed" ta="center" size="sm">
                {t("Roleplay.NoMessages")}
              </Text>
            )}
            {roleplay.chat.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
          </Stack>
        </ScrollArea>

        <Group align="flex-end" wrap="nowrap">
          <Textarea
            style={{ flex: 1 }}
            autosize
            minRows={1}
            maxRows={5}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={t("Roleplay.MessagePlaceholder", {
              player: side === "white" ? whiteName : blackName,
            })}
            disabled={gameState === "settingUp"}
          />
          <Button
            onClick={send}
            disabled={!text.trim() || gameState === "settingUp"}
            leftSection={<IconSend size="1rem" />}
          >
            {t("Roleplay.Send")}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
