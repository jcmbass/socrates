/**
 * Shared topic list editor — extracted from onboard paso-3 (beta-real 06).
 * Add / reorder / delete. Rename is not in the paso-3 UI; not invented here.
 */
import { Pressable, Text, TextInput, View } from "react-native";

import { useT } from "../i18n/react";
import type { Tema } from "../lib/api/types";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";

const ICON_BUTTON_SIZE = 44;

export function TemarioTopicEditor(props: {
  topics: Tema[];
  newTopicTitle: string;
  onChangeNewTopicTitle: (value: string) => void;
  onAddTopic: () => void;
  onDeleteTopic: (topicId: string) => void;
  onMoveTopic: (topicId: string, direction: "up" | "down") => void;
  errorMessage: string | null;
  /** When false, omit the top border (standalone screen vs card). Default true. */
  bordered?: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const bordered = props.bordered ?? true;
  return (
    <View
      style={{
        gap: spacing.sm,
        borderTopWidth: bordered ? 1 : 0,
        borderTopColor: colors.border,
        paddingTop: bordered ? spacing.sm : 0,
      }}
    >
      {props.topics.map((topic, index) => (
        <View key={topic.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
            {index + 1}. {topic.title}
          </Text>
          <IconButton
            label="↑"
            accessibilityLabel={t.onboard.paso3.moveUpA11y}
            disabled={index === 0}
            onPress={() => props.onMoveTopic(topic.id, "up")}
          />
          <IconButton
            label="↓"
            accessibilityLabel={t.onboard.paso3.moveDownA11y}
            disabled={index === props.topics.length - 1}
            onPress={() => props.onMoveTopic(topic.id, "down")}
          />
          <IconButton label="✕" accessibilityLabel={t.onboard.paso3.deleteTopicA11y} onPress={() => props.onDeleteTopic(topic.id)} />
        </View>
      ))}

      {props.errorMessage ? (
        <Text style={{ color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
          {props.errorMessage}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        <TextInput
          value={props.newTopicTitle}
          onChangeText={props.onChangeNewTopicTitle}
          placeholder={t.onboard.paso3.addTopicPlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={60}
          accessibilityLabel={t.onboard.paso3.addTopicPlaceholder}
          style={{
            flex: 1,
            minHeight: MIN_TOUCH_TARGET,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            backgroundColor: colors.surface,
            color: colors.foreground,
            paddingHorizontal: spacing.md,
            fontSize: typography.small.fontSize,
          }}
        />
        <EditorSecondaryButton label={t.onboard.paso3.addTopicButton} onPress={props.onAddTopic} />
      </View>
    </View>
  );
}

function EditorSecondaryButton(props: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: MIN_TOUCH_TARGET,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.accentLight : "transparent",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.md,
      })}
    >
      <Text style={{ color: colors.foreground, fontSize: typography.small.fontSize, fontWeight: typography.weights.medium }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function IconButton(props: { label: string; accessibilityLabel: string; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const disabled = props.disabled ?? false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: ICON_BUTTON_SIZE,
        height: ICON_BUTTON_SIZE,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.accentLight : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize }}>{props.label}</Text>
    </Pressable>
  );
}
