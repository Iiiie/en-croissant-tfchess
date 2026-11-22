import { Button, Card, Group, Loader, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCopy, IconPhotoPlus } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import LocalMedia from "@/components/common/LocalMedia";
import {
  addImageToProfile,
  getProfileImagesDir,
  IMAGE_CATEGORIES,
  type ImageCategory,
  listProfileImages,
  PIECE_ROLES,
  type PieceRole,
  type PlayerProfile,
} from "@/utils/playerProfile";
import { copyFolderPath } from "@/utils/openFolder";

export default function ProfileImages({ profile }: { profile: PlayerProfile }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ImageCategory>("default");
  const [role, setRole] = useState<PieceRole | null>(null);
  const {
    data: images = [],
    isLoading: loading,
    mutate,
  } = useSWR(["profile-images", profile.id, category, role], () =>
    listProfileImages(profile.id, category, role),
  );

  const addImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images and videos",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "avif",
            "bmp",
            "svg",
            "webm",
            "mp4",
            "m4v",
            "mov",
            "ogv",
          ],
        },
      ],
    });
    if (typeof selected !== "string") {
      return;
    }
    await addImageToProfile({
      profileId: profile.id,
      sourcePath: selected,
      category,
      role,
    });
    await mutate();
  };

  return (
    <Stack>
      <Group>
        <Select
          label={t("Players.Category")}
          data={IMAGE_CATEGORIES.map((item) => ({
            value: item,
            label: t(`Players.Category.${item}`),
          }))}
          value={category}
          onChange={(value) => setCategory((value as ImageCategory) ?? "default")}
        />
        {(category === "took" || category === "lost") && (
          <Select
            label={t("Players.Piece")}
            data={PIECE_ROLES.map((item) => ({
              value: item,
              label: t(`Players.Role.${item}`),
            }))}
            value={role}
            onChange={(value) => setRole((value as PieceRole) ?? null)}
            clearable
            placeholder={t("Players.AllPieces")}
          />
        )}
        <Button leftSection={<IconPhotoPlus size="1rem" />} onClick={() => void addImage()}>
          {t("Players.AddImage")}
        </Button>
        <Button
          variant="default"
          leftSection={<IconCopy size="1rem" />}
          onClick={() => void copyFolderPath(getProfileImagesDir(profile.id, category, role))}
        >
          {t("Common.CopyFolderPath")}
        </Button>
      </Group>

      <Text size="xs" c="dimmed">
        {t("Players.ImagesHint")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("Players.ProfileImagesHint")}
      </Text>

      {loading ? (
        <Loader />
      ) : images.length === 0 ? (
        <Text c="dimmed">{t("Players.NoImages")}</Text>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }}>
          {images.map((image) => (
            <Card key={image} withBorder p="xs">
              <LocalMedia
                src={image}
                alt=""
                style={{
                  width: "100%",
                  height: 120,
                  objectFit: "cover",
                  borderRadius: 8,
                  display: "block",
                }}
                videoProps={{ autoPlay: false, muted: true, loop: true, playsInline: true }}
              />
              <Text size="xs" truncate>
                {image.split(/[\\/]/).pop()}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
