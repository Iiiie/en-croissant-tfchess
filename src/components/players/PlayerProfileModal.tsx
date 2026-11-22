import {
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { archetypesAtom, enginesAtom, playerProfilesAtom } from "@/state/atoms";
import { ensureProfileStorage, newPlayerProfile, type PlayerProfile } from "@/utils/playerProfile";

export default function PlayerProfileModal({
  opened,
  onClose,
  profile,
}: {
  opened: boolean;
  onClose: () => void;
  profile: PlayerProfile | null;
}) {
  const { t } = useTranslation();
  const [, setProfiles] = useAtom(playerProfilesAtom);
  const engines = useAtomValue(enginesAtom);
  const archetypes = useAtomValue(archetypesAtom) ?? [];
  const form = useForm<PlayerProfile>({
    initialValues: profile ?? newPlayerProfile({ name: "New Player" }),
    validate: {
      name: (value) => (!value.trim() ? t("Players.NameRequired") : undefined),
    },
  });

  const engineOptions = (engines ?? []).map((engine) => ({
    value: engine.id,
    label: engine.name,
  }));

  const onSubmit = form.onSubmit(async (values) => {
    const next: PlayerProfile = {
      ...values,
      updatedAt: Date.now(),
      engineId: values.kind === "engine" ? values.engineId : null,
      engineSettings: values.kind === "engine" ? values.engineSettings : null,
      go: values.kind === "engine" ? values.go : null,
    };

    setProfiles(async (prev) => {
      const list = await prev;
      return profile ? list.map((item) => (item.id === profile.id ? next : item)) : [...list, next];
    });
    await ensureProfileStorage(next);
    onClose();
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={profile ? t("Players.Edit") : t("Players.Add")}
      size="lg"
    >
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput label={t("Players.Name")} withAsterisk {...form.getInputProps("name")} />

          <SegmentedControl
            data={[
              { value: "human", label: t("Players.Human") },
              { value: "engine", label: t("Players.Engine") },
            ]}
            value={form.values.kind}
            onChange={(value) => form.setFieldValue("kind", value as "human" | "engine")}
          />

          {form.values.kind === "engine" && (
            <Select
              label={t("Players.Engine")}
              data={engineOptions}
              value={form.values.engineId ?? null}
              onChange={(value) => {
                form.setFieldValue("engineId", value);
                const engine = (engines ?? []).find((item) => item.id === value);
                if (engine) {
                  form.setFieldValue("engineSettings", engine.settings ?? []);
                  form.setFieldValue("go", engine.go ?? { t: "Depth", c: 24 });
                }
              }}
              clearable
              searchable
            />
          )}

          <Group grow>
            <NumberInput
              label={t("Players.Elo")}
              min={0}
              max={4000}
              {...form.getInputProps("elo")}
            />
            <NumberInput
              label={t("Players.KFactor")}
              min={1}
              max={100}
              {...form.getInputProps("k")}
            />
          </Group>

          <Stack gap={4}>
            <NumberInput
              label={t("Players.Vulnerability")}
              description={t("Players.Vulnerability.Desc")}
              suffix="x"
              decimalScale={2}
              min={0}
              max={100}
              value={form.values.vulnerability}
              onChange={(value) => {
                if (typeof value === "number" && Number.isFinite(value)) {
                  form.setFieldValue("vulnerability", value);
                }
              }}
            />
          </Stack>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t("Players.Archetypes")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("Players.Archetypes.Pick.Desc")}
            </Text>
            {archetypes.map((archetype) => (
              <Checkbox
                key={archetype.id}
                label={archetype.name}
                checked={form.values.archetypeIds.includes(archetype.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  form.setFieldValue(
                    "archetypeIds",
                    checked
                      ? [...form.values.archetypeIds, archetype.id]
                      : form.values.archetypeIds.filter((id) => id !== archetype.id),
                  );
                }}
              />
            ))}
            {archetypes.length === 0 && (
              <Text size="xs" c="dimmed">
                {t("Players.Archetypes.Empty")}
              </Text>
            )}
          </Stack>

          <TextInput
            label={t("Players.Avatar")}
            placeholder={t("Players.Avatar.Desc")}
            {...form.getInputProps("avatar")}
          />

          <Textarea
            label={t("Players.Notes")}
            minRows={4}
            autosize
            {...form.getInputProps("notes")}
          />

          <Group justify="right">
            <Button variant="default" onClick={onClose}>
              {t("Common.Cancel")}
            </Button>
            <Button type="submit">{t("Common.Save")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
