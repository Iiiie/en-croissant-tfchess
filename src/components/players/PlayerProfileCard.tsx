import { Avatar, Badge, Group, Stack, Text } from "@mantine/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";
import GenericCard from "@/components/common/GenericCard";
import { getProfileAvatar, type PlayerProfile } from "@/utils/playerProfile";

export default function PlayerProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: PlayerProfile;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: avatar } = useSWRImmutable(
    ["profile-avatar", profile.id, profile.avatar, profile.updatedAt],
    () => getProfileAvatar(profile),
  );

  return (
    <GenericCard
      id={profile.id}
      isSelected={selected}
      setSelected={() => onSelect(profile.id)}
      stats={[
        { label: t("Players.Elo"), value: String(profile.elo) },
        {
          label: t("Players.Record"),
          value: `${profile.stats.wins}/${profile.stats.losses}/${profile.stats.draws}`,
        },
        {
          label: t("Players.Vulnerability"),
          value: `${profile.vulnerability.toFixed(2)}x`,
        },
      ]}
      Header={
        <Group wrap="nowrap">
          <Avatar src={avatar ? convertFileSrc(avatar) : undefined} size="lg" radius="md">
            {profile.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={700} truncate>
              {profile.name}
            </Text>
            <Badge size="xs" variant="light">
              {profile.kind === "engine" ? t("Players.Engine") : t("Players.Human")}
            </Badge>
          </Stack>
        </Group>
      }
    />
  );
}
