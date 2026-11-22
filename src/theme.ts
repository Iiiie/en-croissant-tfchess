import {
    ActionIcon,
    Autocomplete,
    createTheme,
    Input,
    localStorageColorSchemeManager,
    type MantineColor,
    Textarea,
    TextInput,
} from "@mantine/core";

export const colorSchemeManager = localStorageColorSchemeManager({
    key: "mantine-color-scheme",
});

export function createAppTheme(primaryColor: MantineColor, spellCheck = false) {
    return createTheme({
        defaultRadius: "sm",
        primaryColor,
        colors: {
            dark: [
                "#C1C2C5",
                "#A6A7AB",
                "#909296",
                "#5c5f66",
                "#373A40",
                "#2C2E33",
                "#25262b",
                "#1A1B1E",
                "#141517",
                "#101113",
            ],
        },
        components: {
            ActionIcon: ActionIcon.extend({
                defaultProps: {
                    variant: "transparent",
                    color: "gray",
                },
            }),
            TextInput: TextInput.extend({ defaultProps: { spellCheck } }),
            Autocomplete: Autocomplete.extend({ defaultProps: { spellCheck } }),
            Textarea: Textarea.extend({ defaultProps: { spellCheck } }),
            Input: Input.extend({
                defaultProps: {
                    // @ts-expect-error - Solve mantine input type check
                    spellCheck,
                },
            }),
        },
    });
}
