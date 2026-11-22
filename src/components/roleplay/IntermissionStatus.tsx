import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { useRoleplayGame } from "@/hooks/useRoleplayGame";

export default function IntermissionStatus({
  roleplay,
}: {
  roleplay: ReturnType<typeof useRoleplayGame>;
}) {
  const { t } = useTranslation();
  const active = roleplay.active;

  if (!active) {
    return null;
  }

  return (
    <Paper withBorder p="xs">
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="sm" fw={700}>
            {t("Roleplay.Intermission")}
          </Text>
          <Badge size="sm">{active.trigger.san}</Badge>
        </Group>
        {(["white", "black"] as const).map((side) => {
          const sideState = active[side];
          const ended = sideState.endedAt !== null;
          const skipped = sideState.reason === "skipped";
          return (
            <Group key={side} justify="space-between">
              <Text size="xs">
                {sideState.profileName} · ×{sideState.severity}
              </Text>
              <Badge size="xs" color={skipped ? "gray" : ended ? "green" : "blue"} variant="light">
                {skipped
                  ? t("Roleplay.Skipped")
                  : ended
                    ? t("Roleplay.Waiting")
                    : t("Roleplay.Active")}
              </Badge>
            </Group>
          );
        })}
        <Text size="xs" c="dimmed">
          {t("Roleplay.BoardPaused")}
        </Text>
      </Stack>
    </Paper>
  );
}
